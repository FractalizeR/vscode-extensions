import * as vscode from 'vscode';
import { DEFAULT_ACTION_ID } from '../../projects/actions/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import {
  runActionById,
  toRenderNode,
  type ActionRegistry,
  type ActionRunner,
} from './actions/index.js';
import { resolveActionNode, type NodeSelection } from './node-selection.js';

export const OPEN_IN_NEW_WINDOW_COMMAND = 'projectsTree.openInNewWindow';
export const OPEN_IN_CURRENT_WINDOW_COMMAND = 'projectsTree.openInCurrentWindow';

/**
 * `builtin.openInCurrentWindow` — see `BUILT_IN_ACTIONS` (projects/actions/builtin.ts). Named
 * separately from `DEFAULT_ACTION_ID` (`builtin.openInNewWindow`, reused below) because the two
 * fixed context-menu entries this file registers are not "the default action" — they are the two
 * `openFolder` windows the plan calls out explicitly (04-actions.md, package 04-C) regardless of
 * what `projectsTree.defaultAction` is currently set to.
 */
const OPEN_IN_CURRENT_WINDOW_ACTION_ID = 'builtin.openInCurrentWindow';

function registerFixedAction(
  command: string,
  actionId: string,
  getRegistry: () => ActionRegistry,
  runner: ActionRunner,
  selection: NodeSelection,
): vscode.Disposable {
  return vscode.commands.registerCommand(command, async (explicitNode?: ClassifiedNode) => {
    const node = resolveActionNode(explicitNode, selection);
    if (node === undefined) {
      void vscode.window.showErrorMessage(vscode.l10n.t('No project is selected.'));
      return;
    }
    const renderNode = toRenderNode(node);
    if (renderNode === undefined) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('The root for "{0}" is no longer configured.', node.facts.name),
      );
      return;
    }

    await runActionById(getRegistry(), runner, actionId, renderNode);
  });
}

/**
 * The two fixed `openFolder` context-menu items every project node offers regardless of the rules
 * file's own actions or `projectsTree.defaultAction` (04-actions.md, package 04-C DoD): "Open in New
 * Window" and "Open in Current Window". Both run a *built-in* action id directly, not through
 * `appliesTo` filtering — a fixed menu item is not subject to the same "only if applicable" rule
 * `showActions`'s QuickPick applies, since these two `openFolder` built-ins carry no `appliesTo` and
 * therefore always match.
 */
export function registerOpenInWindowCommands(
  getRegistry: () => ActionRegistry,
  runner: ActionRunner,
  selection: NodeSelection,
): vscode.Disposable[] {
  return [
    registerFixedAction(
      OPEN_IN_NEW_WINDOW_COMMAND,
      DEFAULT_ACTION_ID,
      getRegistry,
      runner,
      selection,
    ),
    registerFixedAction(
      OPEN_IN_CURRENT_WINDOW_COMMAND,
      OPEN_IN_CURRENT_WINDOW_ACTION_ID,
      getRegistry,
      runner,
      selection,
    ),
  ];
}
