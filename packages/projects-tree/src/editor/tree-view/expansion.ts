/**
 * Remembers which nodes the user had expanded or collapsed, so switching `projectsTree.location`
 * does not reset the tree (`docs/plans/projects-tree/03-tree-view.md`, package 03-C).
 *
 * Why this exists at all, given that the platform already preserves expansion: it preserves it
 * *per view*. `PreserveOrCollapsed`/`PreserveOrExpanded` keep the state of a node "already in the
 * tree" (api-facts.md, fact 41), and the two location modes are two different views with two
 * different ids (fact 5) — so a node that exists in the activity-bar view is *new* to the explorer
 * view, and there the `collapsibleState` returned by `getTreeItem` is what decides. That is exactly
 * the gap this store fills, and also why it does not fight the platform: within one view the stored
 * value is ignored, because `Preserve*` wins for a node already present.
 *
 * The state is per key, three-valued, not a set: "expanded", "collapsed", or absent ("no opinion —
 * use the caller's own per-kind default"). A plain set of expanded keys (this store's original
 * shape) cannot express "the user collapsed this" for a node whose own default is already
 * `Expanded` — round 06 review, codex-03, found exactly that gap for root groups, which default to
 * `Expanded` when non-empty. `item.ts` applies "stored state, else the per-kind default"; this
 * module only ever answers what was stored, never a kind-specific default — it has no idea what
 * kind of element a key belongs to.
 *
 * The store is deliberately not a cache of tree structure — only per-key state. It is written on
 * every expand/collapse and read when an item is built.
 */
import type { NodeKey } from './registry.js';

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

export type ExpansionState = 'expanded' | 'collapsed';

const STORAGE_KEY = 'projectsTree.expandedNodes';

/**
Current on-disk shape: two key lists, one per state. Anything else (including the store's original
shape, a plain array) is handled separately by the constructor rather than here.
*/
interface StoredStateV2 {
  readonly expanded: readonly unknown[];
  readonly collapsed: readonly unknown[];
}

function isStoredStateV2(value: unknown): value is StoredStateV2 {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { expanded?: unknown; collapsed?: unknown };
  return Array.isArray(candidate.expanded) && Array.isArray(candidate.collapsed);
}

function stringsOf(values: readonly unknown[]): string[] {
  return values.filter((value): value is string => typeof value === 'string');
}

export class ExpansionStore {
  readonly #state = new Map<NodeKey, ExpansionState>();

  constructor(private readonly memento: ExpansionMemento) {
    const stored = memento.get(STORAGE_KEY);
    // Anything but a recognized shape is treated as absent rather than trusted: this value has
    // been on disk across upgrades, and a shape change must degrade to "no opinion anywhere"
    // instead of throwing during activation.
    if (isStoredStateV2(stored)) {
      for (const key of stringsOf(stored.expanded)) this.#state.set(key, 'expanded');
      for (const key of stringsOf(stored.collapsed)) this.#state.set(key, 'collapsed');
    } else if (Array.isArray(stored)) {
      // The store's original shape: a plain array of expanded keys, nothing else. Every entry
      // here degrades to "explicitly expanded" — the only opinion that shape could ever record —
      // and every other key keeps the "no opinion" it always had under it.
      for (const key of stringsOf(stored)) this.#state.set(key, 'expanded');
    }
  }

  #persist(): PromiseLike<void> {
    const expanded: NodeKey[] = [];
    const collapsed: NodeKey[] = [];
    for (const [key, state] of this.#state) {
      (state === 'expanded' ? expanded : collapsed).push(key);
    }
    return this.memento.update(STORAGE_KEY, { expanded, collapsed });
  }

  /**
  What was stored for `key`, or `undefined` for "never recorded" — distinct from `'collapsed'`,
  which means the user collapsed it on purpose. Callers combine this with their own per-kind
  default; this store does not know what kind of element `key` names.
  */
  stateOf(key: NodeKey): ExpansionState | undefined {
    return this.#state.get(key);
  }

  /**
  Records a change and persists it. Returns the promise so a caller that must not race a following
  read can await it; the tree-view event handlers deliberately do not.
  */
  record(key: NodeKey, isExpanded: boolean): PromiseLike<void> {
    this.#state.set(key, isExpanded ? 'expanded' : 'collapsed');
    return this.#persist();
  }

  /**
  Drops keys no longer present in the tree. Without this the map grows for the life of the
  installation: a project renamed or deleted on disk leaves its key behind forever, and the plan
  already named unbounded-growth-without-invalidation as the defect class stage 07 exists to fix.
  */
  retainOnly(livingKeys: Iterable<NodeKey>): PromiseLike<void> | undefined {
    const living = new Set(livingKeys);
    let hasChanged = false;
    for (const key of this.#state.keys()) {
      if (living.has(key)) continue;
      this.#state.delete(key);
      hasChanged = true;
    }
    return hasChanged ? this.#persist() : undefined;
  }
}
