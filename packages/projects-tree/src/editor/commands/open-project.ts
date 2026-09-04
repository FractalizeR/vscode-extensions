/**
 * `docs/plans/projects-tree/04-actions.md`, package 04-D: the only way to use the extension when
 * `projectsTree.location` is `'none'` — no tree, no context menu, just this command.
 *
 * There is no background walk and no on-disk cache (that is `07-cache-and-reactivity.md`'s job):
 * the first invocation in a session pays the full cost of `discoverProjectTree` over every
 * configured root, shown as a cancellable notification progress (api-facts.md, fact 79/80) so a
 * large tree does not look like a hang. `ProjectListCache` below is what makes every later
 * invocation in the same session free — until `extension.ts` invalidates it.
 */
import * as vscode from 'vscode';
import type { Rule } from '../../projects/classification/index.js';
import {
  CancellationError,
  CancellationSource,
  discoverProjectTree,
  GenerationTracker,
  type ClassifiedNode,
  type FileSystemReader,
} from '../../projects/discovery/index.js';
import type { ConfiguredRoot } from '../configuration/index.js';
import { RUN_PRIMARY_ACTION_COMMAND } from './run-primary-action.js';

export const OPEN_PROJECT_COMMAND = 'projectsTree.openProject';

/**
 * Session-scoped cache of the flattened project list. `invalidate()` is the whole public contract
 * `extension.ts` needs: it is called from the exact place `NodeRegistry`/`RootGroupRegistry` are
 * invalidated (a rules-file change), plus whenever the roots or `maxDepth` signature changes —
 * neither of which those two registries need to react to the same way, since `canonicalize`/
 * `retainOnly` already keep them correct incrementally for those cases (`tree-view/registry.ts`).
 * This cache holds no such incremental machinery — it is a flat list, not an identity table — so a
 * roots/maxDepth change must drop it outright rather than try to patch it.
 *
 * `#building` collapses concurrent invocations (e.g. a double-click on the command, or the Command
 * Palette re-opened while a first walk is still in flight) onto the same in-flight walk instead of
 * starting a second one; a cancelled or failed walk clears it so the next invocation retries rather
 * than replaying the same rejection forever.
 *
 * `#generations` is what keeps `invalidate()` correct against a walk already running when it is
 * called (R07-CACHE-RACE): that walk is not cancelled, but its result is checked against the
 * generation current *when the walk started*, not when it finishes, so an `invalidate()` that
 * happened in between makes the result arrive too late to be published. `invalidate()` also drops
 * `#building` itself, not only `#cached` — otherwise a `get()` racing the invalidation would still
 * join that same superseded promise instead of starting a fresh build.
 */
export class ProjectListCache {
  #cached: readonly ClassifiedNode[] | undefined;
  #building: Promise<readonly ClassifiedNode[] | undefined> | undefined;
  readonly #generations = new GenerationTracker();

  invalidate(): void {
    this.#cached = undefined;
    this.#building = undefined;
    this.#generations.begin();
  }

  async get(
    build: () => Promise<readonly ClassifiedNode[] | undefined>,
  ): Promise<readonly ClassifiedNode[] | undefined> {
    if (this.#cached !== undefined) return this.#cached;
    if (this.#building === undefined) {
      const generation = this.#generations.begin();
      this.#building = (async () => {
        const result = await build();
        const outcome = this.#generations.commit(generation, result);
        if (result !== undefined && outcome.applied) this.#cached = result;
        return result;
      })();
    }
    const building = this.#building;
    try {
      return await building;
    } finally {
      if (this.#building === building) this.#building = undefined;
    }
  }
}

interface ProjectQuickPickItem extends vscode.QuickPickItem {
  readonly node: ClassifiedNode;
}

/**
 * Every node classified `project: true`, at any depth — not just each root's immediate top-level
 * projects: a project descended into via `descend: 'submodules'` (02-core.md) still shows up here,
 * one entry per submodule, since each is independently a project a user might want to jump to.
 */
function collectProjects(nodes: readonly ClassifiedNode[]): ClassifiedNode[] {
  const projects: ClassifiedNode[] = [];
  for (const node of nodes) {
    if (node.verdict.project.value) projects.push(node);
    if (node.children.length > 0) projects.push(...collectProjects(node.children));
  }
  return projects;
}

function rootLabelOf(roots: readonly ConfiguredRoot[], rootId: string): string {
  return roots.find((root) => root.id === rootId)?.label ?? rootId;
}

function toQuickPickItems(
  nodes: readonly ClassifiedNode[],
  roots: readonly ConfiguredRoot[],
): ProjectQuickPickItem[] {
  return nodes.map((node) => ({
    label: node.facts.name,
    // Two fields, not one (api-facts.md, fact 82): `description` names the root a same-named
    // project belongs to, `detail` is the full path — either alone leaves two identically-named
    // projects in different roots indistinguishable in the list.
    description: rootLabelOf(roots, node.facts.rootId),
    detail: node.facts.absolutePath,
    node,
  }));
}

/**
 * Bridges the editor's `CancellationToken` (api-facts.md, fact 81) to the core's own
 * `CancellationSource` (`projects/discovery/cancellation.ts`) — the core cannot know `vscode` at
 * all, so nothing here can pass the token itself into `discoverProjectTree`.
 */
async function collectAllProjects(
  roots: readonly ConfiguredRoot[],
  rules: readonly Rule[],
  fs: FileSystemReader,
  maxDepth: number,
): Promise<readonly ClassifiedNode[] | undefined> {
  return vscode.window.withProgress(
    {
      // Only `Notification` renders a cancel button at all (fact 80) — a status-bar or window
      // progress would leave the walk uninterruptible, defeating the DoD's cancellation test.
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Collecting projects…'),
      cancellable: true,
    },
    async (_progress, token) => {
      const cancellation = new CancellationSource();
      const subscription = token.onCancellationRequested(() => {
        cancellation.cancel();
      });
      try {
        const result = await discoverProjectTree(roots, rules, fs, cancellation.signal, {
          maxDepth,
        });
        return collectProjects(result.nodes);
      } catch (error) {
        if (error instanceof CancellationError) return;
        throw error;
      } finally {
        subscription.dispose();
      }
    },
  );
}

/**
 * `listRoots`/`listRules`/`getMaxDepth` are suppliers, not fixed values, for the same reason every
 * other command in this directory takes them that way: roots, the rules file and `maxDepth` can all
 * change within a session, and a handler closing over one snapshot from activation would run every
 * later invocation against a stale one. `listRoots` reads `projectsTree.roots` directly rather than
 * going through the tree provider's own supplier — that one collapses to `[]` in `location: 'none'`
 * (`extension.ts`), which is exactly the one placement mode this command exists to serve.
 */
export function registerOpenProjectCommand(
  cache: ProjectListCache,
  listRoots: () => readonly ConfiguredRoot[],
  listRules: () => readonly Rule[],
  getMaxDepth: () => number,
  fs: FileSystemReader,
): vscode.Disposable {
  return vscode.commands.registerCommand(OPEN_PROJECT_COMMAND, async () => {
    const roots = listRoots();
    if (roots.length === 0) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('No project roots are configured yet. Add one with "Add Root Folder…".'),
      );
      return;
    }

    const projects = await cache.get(() =>
      collectAllProjects(roots, listRules(), fs, getMaxDepth()),
    );
    if (projects === undefined) return; // cancelled

    if (projects.length === 0) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('No projects found under the configured roots.'),
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(toQuickPickItems(projects, roots), {
      placeHolder: vscode.l10n.t('Select a project to open'),
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (picked === undefined) return;

    // Reuses 04-C's primary-action resolution chain (`run-primary-action.ts`) through the command
    // it registers, rather than importing `ActionRegistry`/`ActionRunner` a second time here — the
    // same node argument a tree click passes takes the same path (`verdict.primaryAction.value`,
    // then `projectsTree.defaultAction`).
    await vscode.commands.executeCommand(RUN_PRIMARY_ACTION_COMMAND, picked.node);
  });
}
