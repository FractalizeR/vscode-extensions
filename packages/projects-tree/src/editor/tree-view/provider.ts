import * as vscode from 'vscode';
import {
  CancellationError,
  CancellationSource,
  discoverProjectTree,
  GenerationTracker,
  type FileSystemReader,
  type Generation,
} from '../../projects/discovery/index.js';
import type { Rule } from '../../projects/classification/index.js';
import type { ConfiguredRoot, ShowRootNodes } from '../configuration/index.js';
import type { HighlightDecorationProvider } from '../decorations/index.js';
import { toTreeItem } from './item.js';
import { sortChildren } from './sort.js';
import type { ExpansionStore } from './expansion.js';
import { treeElementKey, type NodeRegistry, type RootGroupRegistry } from './registry.js';
import type { TreeElement } from './root-group.js';
import { buildTopLevel } from './top-level.js';

/**
 * Wires the core (`discoverProjectTree`) to `vscode.TreeDataProvider`. `getChildren` never reads
 * the filesystem itself — `refresh()` walks every configured root up to discovery's own
 * `maxDepth` default and hands the whole classified tree to `NodeRegistry`; `getChildren` only
 * reads back children the walk already computed. The tree still *renders* lazily (VS Code never
 * asks for a collapsed node's children), but per-node on-demand filesystem reads and their cache
 * invalidation are `docs/plans/projects-tree/07-cache-and-reactivity.md`'s job, deliberately out of
 * this slice.
 *
 * The core no longer emits a node for a root itself (`docs/plans/projects-tree/00-overview.md`,
 * "Корень — контейнер, а не узел") — `discoverProjectTree`'s result is every root's children,
 * flattened, each still carrying `facts.rootId`. Whether that flat list is regrouped into one
 * container per root is `buildTopLevel`'s decision alone, driven by `showRootNodes` and how many
 * roots are configured.
 */
export class ProjectsTreeProvider
  implements vscode.TreeDataProvider<TreeElement>, vscode.Disposable
{
  readonly #emitter = new vscode.EventEmitter<TreeElement | undefined>();
  #topLevel: readonly TreeElement[] = [];
  // Two overlapping `refresh()` calls are routine, not exceptional: `onTreeConfigurationChanged`
  // fires once per changed setting, and the refresh command is a button the user can click twice.
  // `#generations` decides which call's result wins (the one that *started* last, not the one
  // that *finishes* last); `#activeCancellation` makes the loser actually stop rather than run to
  // completion and simply be ignored (round 05 finding M3: cancellation must mean "stop", not
  // "do not start a new one").
  readonly #generations = new GenerationTracker();
  #activeCancellation: CancellationSource | undefined;

  readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined> = this.#emitter.event;

  constructor(
    private readonly listRoots: () => readonly ConfiguredRoot[],
    private readonly getShowRootNodes: () => ShowRootNodes,
    private readonly fs: FileSystemReader,
    // A supplier, symmetrically with `listRoots` above, not a fixed array: the rules come from a
    // file the user edits, so they change within a session. Reading them per refresh is what makes
    // an edit take effect without recreating this provider or reloading the window; the alternative
    // — capturing the array at construction — is what made the whole of highlighting unreachable
    // in the first place (round 06 review, codex-02).
    private readonly listRules: () => readonly Rule[],
    private readonly nodeRegistry: NodeRegistry,
    private readonly groupRegistry: RootGroupRegistry,
    // The expansion store, not a bare predicate: `refresh()` needs both halves of it — reading
    // remembered state when an item is built, and pruning keys for nodes that no longer exist.
    // Passing the collaborator instead of one of its methods is what keeps the prune from becoming
    // a second call site a caller can forget, the way `decorations` below already does
    // (docs/plans/projects-tree/review-05/REPORT.md, M5).
    private readonly expansion: Pick<ExpansionStore, 'stateOf' | 'retainOnly'>,
    // Optional: this class works without a decoration carrier (every existing test constructs it
    // without one). When given, every `refresh()` feeds it the freshly built top level so
    // `FileDecoration`s stay in sync without a second call site the way an unwired feature would
    // (docs/plans/projects-tree/review-05/REPORT.md, M5).
    private readonly decorations?: Pick<HighlightDecorationProvider, 'update'>,
  ) {}

  /**
  Applies `topLevel` only if `generation` is still the latest — i.e. no later `refresh()` call has
  already started. `#activeCancellation.cancel()` stops a superseded walk before it finishes in the
  common case, but `commit` is what stays correct even if a result slips through anyway (a fake
  `FileSystemReader` in a test that never calls `throwIfCancelled`, or a walk cancelled too late to
  matter) — defense in depth, not the same guarantee twice.
  */
  #commit(generation: Generation, topLevel: readonly TreeElement[]): void {
    const outcome = this.#generations.commit(generation, topLevel);
    if (!outcome.applied) return;
    this.#topLevel = outcome.result;
    this.decorations?.update(this.#topLevel);
    this.#sweepPerNodeState();
    this.#emitter.fire(undefined);
  }

  /**
  Sweeps every piece of per-node state against the tree that actually exists now: the two identity
  registries and the expansion store, all keyed by `treeElementKey`.

  The live set is computed from the freshly built tree rather than read back from the registries.
  That direction matters and was found by a failing test, not by reading: `canonicalize` only adds
  and updates, so a registry still holds an entry for a directory deleted from disk — pruning the
  expansion store against `NodeRegistry`'s keys therefore kept exactly the keys it was supposed to
  drop (round 06 review, qwen-03/qwen-06).
  */
  #sweepPerNodeState(): void {
    const live = new Set<string>();
    const collect = (elements: readonly TreeElement[]): void => {
      for (const element of elements) {
        live.add(treeElementKey(element));
        collect(element.children);
      }
    };
    collect(this.#topLevel);
    this.nodeRegistry.retainOnly(live);
    this.groupRegistry.retainOnly(live);
    void this.expansion.retainOnly(live);
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return toTreeItem(element, (key) => this.expansion.stateOf(key));
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (element === undefined) return [...this.#topLevel];
    return sortChildren(element.children);
  }

  async refresh(): Promise<void> {
    // Stop whichever walk is still in flight before starting this one — see the field comments
    // above. Unconditional: even the empty-roots shortcut below must supersede a slower walk
    // still running from a previous call.
    this.#activeCancellation?.cancel();
    const generation = this.#generations.begin();

    const roots = this.listRoots();
    if (roots.length === 0) {
      this.#commit(generation, []);
      return;
    }

    const cancellation = new CancellationSource();
    this.#activeCancellation = cancellation;
    let result;
    try {
      result = await discoverProjectTree(roots, this.listRules(), this.fs, cancellation.signal);
    } catch (error) {
      // A newer refresh() cancelled this one; its result never existed as far as the tree is
      // concerned. Any other error is a real failure and must propagate.
      if (error instanceof CancellationError) return;
      throw error;
    }
    const canonicalNodes = result.nodes.map((node) => this.nodeRegistry.canonicalize(node));
    const topLevel = buildTopLevel(
      canonicalNodes,
      roots,
      this.getShowRootNodes(),
      this.groupRegistry,
    );
    this.#commit(generation, topLevel);
  }

  dispose(): void {
    this.#emitter.dispose();
  }
}
