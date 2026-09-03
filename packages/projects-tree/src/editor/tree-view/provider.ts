import * as vscode from 'vscode';
import {
  CancellationSource,
  discoverProjectTree,
  type FileSystemReader,
} from '../../projects/discovery/index.js';
import type { Rule } from '../../projects/classification/index.js';
import type { ConfiguredRoot, ShowRootNodes } from '../configuration/index.js';
import { toTreeItem } from './item.js';
import { sortChildren } from './sort.js';
import type { NodeRegistry, RootGroupRegistry } from './registry.js';
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

  readonly onDidChangeTreeData: vscode.Event<TreeElement | undefined> = this.#emitter.event;

  constructor(
    private readonly listRoots: () => readonly ConfiguredRoot[],
    private readonly getShowRootNodes: () => ShowRootNodes,
    private readonly fs: FileSystemReader,
    private readonly rules: readonly Rule[],
    private readonly nodeRegistry: NodeRegistry,
    private readonly groupRegistry: RootGroupRegistry,
  ) {}

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return toTreeItem(element);
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (element === undefined) return [...this.#topLevel];
    return sortChildren(element.children);
  }

  async refresh(): Promise<void> {
    const roots = this.listRoots();
    if (roots.length === 0) {
      this.#topLevel = [];
      this.#emitter.fire(undefined);
      return;
    }
    const cancellation = new CancellationSource();
    const result = await discoverProjectTree(roots, this.rules, this.fs, cancellation.signal);
    const canonicalNodes = result.nodes.map((node) => this.nodeRegistry.canonicalize(node));
    this.#topLevel = buildTopLevel(
      canonicalNodes,
      roots,
      this.getShowRootNodes(),
      this.groupRegistry,
    );
    this.#emitter.fire(undefined);
  }

  dispose(): void {
    this.#emitter.dispose();
  }
}
