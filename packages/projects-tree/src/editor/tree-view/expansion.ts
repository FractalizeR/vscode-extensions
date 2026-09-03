/**
 * Remembers which nodes the user had expanded, so switching `projectsTree.location` does not
 * collapse the tree (`docs/plans/projects-tree/03-tree-view.md`, package 03-C).
 *
 * Why this exists at all, given that the platform already preserves expansion: it preserves it
 * *per view*. `PreserveOrCollapsed`/`PreserveOrExpanded` keep the state of a node "already in the
 * tree" (api-facts.md, fact 41), and the two location modes are two different views with two
 * different ids (fact 5) — so a node that exists in the activity-bar view is *new* to the explorer
 * view, and there the `collapsibleState` returned by `getTreeItem` is what decides. That is exactly
 * the gap this store fills, and also why it does not fight the platform: within one view the stored
 * value is ignored, because `Preserve*` wins for a node already present.
 *
 * The store is deliberately not a cache of tree structure — only a set of `NodeKey`s. It is written
 * on every expand/collapse and read when an item is built.
 */
import { nodeKey, type NodeKey } from './registry.js';
import { isRootGroupNode, type TreeElement } from './root-group.js';

/**
Persistence port, kept as an interface so this module needs no `vscode` and is testable without an
editor. `vscode.ExtensionContext.globalState` satisfies it; its `update` is async (fact 48), so the
return type is `PromiseLike` — the standard-library supertype of the `Thenable` VS Code returns,
chosen so this file needs no type from the editor's own `.d.ts`.
*/
export interface ExpansionMemento {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/**
The identity of a tree element for storage purposes, and deliberately the same string `item.id`
carries: the platform matches a node's remembered expansion state by `TreeItem.id` (fact 27), so a
key derived differently here would record state the view could never match back.
*/
export function treeElementKey(element: TreeElement): NodeKey {
  return isRootGroupNode(element)
    ? `root:${element.rootId}`
    : nodeKey(element.facts.rootId, element.facts.pathFromRoot);
}

const STORAGE_KEY = 'projectsTree.expandedNodes';

export class ExpansionStore {
  readonly #expanded: Set<NodeKey>;

  constructor(private readonly memento: ExpansionMemento) {
    const stored = memento.get(STORAGE_KEY);
    // Anything but an array of strings is treated as absent rather than trusted: this value has
    // been on disk across upgrades, and a shape change must degrade to "nothing expanded" instead
    // of throwing during activation.
    this.#expanded = new Set(
      Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : [],
    );
  }

  isExpanded(key: NodeKey): boolean {
    return this.#expanded.has(key);
  }

  /**
  Records a change and persists it. Returns the promise so a caller that must not race a following
  read can await it; the tree-view event handlers deliberately do not.
  */
  record(key: NodeKey, isExpanded: boolean): PromiseLike<void> {
    if (isExpanded) this.#expanded.add(key);
    else this.#expanded.delete(key);
    return this.memento.update(STORAGE_KEY, [...this.#expanded]);
  }

  /**
  Drops keys no longer present in the tree. Without this the set grows for the life of the
  installation: a project renamed or deleted on disk leaves its key behind forever, and the plan
  already named unbounded-growth-without-invalidation as the defect class stage 07 exists to fix.
  */
  retainOnly(livingKeys: Iterable<NodeKey>): PromiseLike<void> | undefined {
    const living = new Set(livingKeys);
    let hasChanged = false;
    for (const key of this.#expanded) {
      if (living.has(key)) continue;
      this.#expanded.delete(key);
      hasChanged = true;
    }
    return hasChanged ? this.memento.update(STORAGE_KEY, [...this.#expanded]) : undefined;
  }
}
