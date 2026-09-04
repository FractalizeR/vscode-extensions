import { HIDE_COMMAND, MANAGE_HIDDEN_COMMAND } from './hidden.js';
import { REFRESH_COMMAND } from './refresh.js';
import { OPEN_IN_CURRENT_WINDOW_COMMAND, OPEN_IN_NEW_WINDOW_COMMAND } from './open-in-window.js';
import { OPEN_PROJECT_COMMAND } from './open-project.js';
import { ADD_ROOT_COMMAND, REMOVE_ROOT_COMMAND } from './roots.js';
import { RUN_ACTION_COMMAND } from './run-action.js';
import { RUN_PRIMARY_ACTION_COMMAND } from './run-primary-action.js';
import { SHOW_ACTIONS_COMMAND } from './show-actions.js';

/**
 * Every command id this package registers, in one place a test can compare against
 * `package.json`'s `contributes.commands` — the same reasoning `tree-view/location.ts`'s
 * `ALL_VIEW_IDS` gives for view ids: a manifest/code mismatch here shows up as a menu item or
 * keybinding target that silently does nothing, and nothing else in the suite would catch it
 * (`manifest-contract.test.ts`'s own doc comment).
 */
export const ALL_COMMAND_IDS = [
  REFRESH_COMMAND,
  ADD_ROOT_COMMAND,
  REMOVE_ROOT_COMMAND,
  RUN_PRIMARY_ACTION_COMMAND,
  RUN_ACTION_COMMAND,
  SHOW_ACTIONS_COMMAND,
  OPEN_IN_NEW_WINDOW_COMMAND,
  OPEN_IN_CURRENT_WINDOW_COMMAND,
  OPEN_PROJECT_COMMAND,
  HIDE_COMMAND,
  MANAGE_HIDDEN_COMMAND,
] as const;

/**
 * The fixed `view/item/context` entries a project or plain-folder node offers
 * (`docs/plans/projects-tree/04-actions.md`, packages 04-C and 04-E). `Hide` is scoped to both
 * `viewItem == project` and `viewItem == folder` — unlike the other three, which apply to a project
 * only — so `manifest-contract.test.ts` checks it against a looser guard than the rest of this list.
 * Duplicated onto both view ids in `package.json` (api-facts.md, fact 5) — `manifest-contract.
 * test.ts` checks both copies exist, the same way it already does for `view/title`.
 */
export const PROJECT_CONTEXT_MENU_COMMAND_IDS = [
  OPEN_IN_NEW_WINDOW_COMMAND,
  OPEN_IN_CURRENT_WINDOW_COMMAND,
  SHOW_ACTIONS_COMMAND,
  HIDE_COMMAND,
] as const;

/**
 * The fixed `view/item/context` entries a root-group container offers — currently just `Remove
 * Root` (package 04-E). Kept apart from `PROJECT_CONTEXT_MENU_COMMAND_IDS`: a root group is not a
 * `ClassifiedNode` and carries no `Verdict` (`tree-view/root-group.ts`), so it is a different
 * `viewItem` guard (`rootGroup`, not `project`/`folder`) and `manifest-contract.test.ts` checks the
 * two lists against different guards rather than merging them into one.
 */
export const ROOT_GROUP_CONTEXT_MENU_COMMAND_IDS = [REMOVE_ROOT_COMMAND] as const;
