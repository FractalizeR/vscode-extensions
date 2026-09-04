import * as vscode from 'vscode';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import {
  runActionById,
  toRenderNode,
  type ActionRegistry,
  type ActionRunner,
} from './actions/index.js';
import { resolveActionNode, type NodeSelection } from './node-selection.js';

export const RUN_PRIMARY_ACTION_COMMAND = 'projectsTree.runPrimaryAction';

/**
 * Replaces the stage-03 vertical slice `OPEN_PROJECT_COMMAND` (`commands/open-project.ts`, removed
 * by this package): a project node's click now resolves an action through the chain
 * `docs/plans/projects-tree/04-actions.md` (package 04-C) names —
 * `Verdict.primaryAction.value` first, `projectsTree.defaultAction` (`readDefaultAction`) otherwise
 * — instead of always forcing `openFolder` in a new window.
 *
 * `getRegistry`, not a fixed `ActionRegistry` — same reasoning `ProjectsTreeProvider`'s own
 * `listRules` supplier documents: the composition root rebuilds the registry whenever the rules
 * file changes (its `actions` section can add or redefine entries), and a command handler closing
 * over one fixed instance from activation would keep running against a stale set forever.
 */
export function registerRunPrimaryActionCommand(
  getRegistry: () => ActionRegistry,
  runner: ActionRunner,
  selection: NodeSelection,
  readDefaultAction: () => string,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    RUN_PRIMARY_ACTION_COMMAND,
    async (explicitNode?: ClassifiedNode) => {
      const node = resolveActionNode(explicitNode, selection);
      if (node === undefined) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t('No project is selected to run the primary action on.'),
        );
        return;
      }
      const renderNode = toRenderNode(node);
      if (renderNode === undefined) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t('The root for "{0}" is no longer configured.', node.facts.name),
        );
        return;
      }

      const actionId = node.verdict.primaryAction.value ?? readDefaultAction();
      await runActionById(getRegistry(), runner, actionId, renderNode);
    },
  );
}
