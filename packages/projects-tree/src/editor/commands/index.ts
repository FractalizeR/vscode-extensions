// Public surface of `commands/`: only what `extension.ts` (the composition root),
// `tree-view/item.ts` and `manifest-contract.test.ts` actually consume through this file. A symbol
// used only by another file in this directory (e.g. `ADD_ROOT_COMMAND`, read by
// `registered-commands.ts` directly) has no reason to also round-trip through here — `knip` flags
// exactly that as a dead re-export, which is what caught the debt this file used to carry.
export { registerAddRootCommand, registerRemoveRootCommand } from './roots.js';
export {
  registerHideCommand,
  registerManageHiddenCommand,
  MANAGE_HIDDEN_COMMAND,
} from './hidden.js';
export { registerRefreshCommand } from './refresh.js';
export {
  ALL_COMMAND_IDS,
  PROJECT_CONTEXT_MENU_COMMAND_IDS,
  ROOT_GROUP_CONTEXT_MENU_COMMAND_IDS,
} from './registered-commands.js';
export { createActionRegistry, createActionRunner, type ActionRegistry } from './actions/index.js';
export type { NodeSelection } from './node-selection.js';
export { registerOpenInWindowCommands } from './open-in-window.js';
export { registerOpenProjectCommand, ProjectListCache } from './open-project.js';
export { registerRunActionCommand } from './run-action.js';
export {
  registerRunPrimaryActionCommand,
  RUN_PRIMARY_ACTION_COMMAND,
} from './run-primary-action.js';
export { registerShowActionsCommand } from './show-actions.js';
