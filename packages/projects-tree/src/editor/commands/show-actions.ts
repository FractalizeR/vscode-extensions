import * as vscode from 'vscode';
import type { ActionDefinition } from '../../projects/actions/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import {
  displayTitleFor,
  toRenderNode,
  type ActionRegistry,
  type ActionRunner,
} from './actions/index.js';
import { resolveActionNode, type NodeSelection } from './node-selection.js';

export const SHOW_ACTIONS_COMMAND = 'projectsTree.showActions';

interface ActionQuickPickItem extends vscode.QuickPickItem {
  readonly action: ActionDefinition;
}

/**
 * The platform's own answer to "populate a menu from settings" being impossible (api-facts.md, fact
 * 20): this command is a `QuickPick`, filtered to `registry.applicableTo(node)` — every action,
 * built-in or file-declared, whose `appliesTo` matches — built fresh on every invocation, since the
 * rules file (and therefore the action set) can change between two runs of this command.
 */
export function registerShowActionsCommand(
  getRegistry: () => ActionRegistry,
  runner: ActionRunner,
  selection: NodeSelection,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    SHOW_ACTIONS_COMMAND,
    async (explicitNode?: ClassifiedNode) => {
      const node = resolveActionNode(explicitNode, selection);
      if (node === undefined) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t('No project is selected to show actions for.'),
        );
        return;
      }

      const applicable = getRegistry().applicableTo(node);
      if (applicable.length === 0) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('No action applies to "{0}".', node.facts.name),
        );
        return;
      }

      const items: ActionQuickPickItem[] = applicable.map((action) => {
        const title = displayTitleFor(action);
        return {
          label: title,
          action,
          // A description showing the raw id is only useful once the label itself is something
          // other than the id — a built-in's localized title or a file action's own title.
          ...(title !== action.id && { description: action.id }),
        };
      });
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Select an action for "{0}"', node.facts.name),
      });
      if (picked === undefined) return;

      const renderNode = toRenderNode(node);
      if (renderNode === undefined) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t('The root for "{0}" is no longer configured.', node.facts.name),
        );
        return;
      }

      await runner.run(picked.action, renderNode);
    },
  );
}
