import type { ClassifiedNode } from '../../projects/discovery/index.js';

/**
 * The composition root's half of a structural seam, same pattern as `Refreshable`
 * (`commands/refresh.ts`): a command handler that needs "whatever project node is currently
 * selected in the tree" cannot import `tree-view/`'s `TreeElement`/`isRootGroupNode` to compute it
 * — `commands/` already exports `RUN_PRIMARY_ACTION_COMMAND`-style constants that
 * `tree-view/item.ts` imports, so the reverse edge would be a cycle `no-circular`
 * (`.dependency-cruiser.mjs`) rejects. `extension.ts` holds the actual `TreeView` instances and is
 * the one place allowed to depend on both sides; it implements this interface and hands it down.
 */
export interface NodeSelection {
  /**
  The currently selected project node, or `undefined` when nothing is selected or the selection is
  not a project (e.g. a plain folder or a root group container). Every command in this directory
  that can be invoked without an explicit node (keybinding, Command Palette) falls back to this.
  */
  currentProjectNode(): ClassifiedNode | undefined;

  /**
  The currently selected node regardless of `verdict.project` — a plain folder counts, unlike
  `currentProjectNode()`. "Hide" (`commands/hidden.ts`, package 04-E) needs this: a folder that is
  not itself a project is exactly the kind of node a user hides (`node_modules`-shaped clutter that
  the default rules did not already catch). Still excludes a root group container — that has no
  `ClassifiedNode`/`Verdict` at all (`tree-view/root-group.ts`) and "Remove Root" is its own command.
  */
  currentNode(): ClassifiedNode | undefined;
}

/**
 * Resolves the node a command should act on: the explicit argument the platform already supplied
 * (a click, or a `view/item/context` menu invocation — both pass the tree item automatically) wins;
 * only when nothing was supplied does the command fall back to whatever is selected in the tree —
 * the case a keybinding invocation is in, since a keybinding's `args` carries no tree item unless
 * the keybinding's author put one there (api-facts.md, fact 29).
 */
export function resolveActionNode(
  explicit: ClassifiedNode | undefined,
  selection: NodeSelection,
): ClassifiedNode | undefined {
  return explicit ?? selection.currentProjectNode();
}

/**
 * Same resolution order as `resolveActionNode`, but for commands that operate on any node — "Hide"
 * is the only caller today, and unlike every action command, a folder that is not a project is a
 * valid target for it.
 */
export function resolveNode(
  explicit: ClassifiedNode | undefined,
  selection: NodeSelection,
): ClassifiedNode | undefined {
  return explicit ?? selection.currentNode();
}
