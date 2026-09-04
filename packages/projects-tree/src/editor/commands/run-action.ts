import * as vscode from 'vscode';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import {
  runActionById,
  toRenderNode,
  type ActionRegistry,
  type ActionRunner,
} from './actions/index.js';
import { resolveActionNode, type NodeSelection } from './node-selection.js';

export const RUN_ACTION_COMMAND = 'projectsTree.runAction';

/**
 * The argument shape a `contributes.keybindings` entry's `args` carries (api-facts.md, fact 29's
 * quoted example is exactly this pattern: a plain object, not a positional list). An object rather
 * than a bare id string so a future field (e.g. an explicit node, for a caller other than a
 * keybinding) has somewhere to go without breaking the shape every existing keybinding already
 * points at — the same reasoning `ActionSpec.terminal`'s named fields follow over a positional
 * tuple. Not exported: nothing outside this file constructs one — a keybinding's `args` is JSON in
 * `package.json`, not a value built through this type — so an export would be dead weight `knip`
 * would flag.
 */
interface RunActionArgs {
  readonly id: string;
  readonly node?: ClassifiedNode;
}

function isRunActionArgs(value: unknown): value is RunActionArgs {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'string'
  );
}

/**
 * Gives a favorite action a keybinding without a menu entry (04-actions.md, package 04-C —
 * `contributes.menus` cannot be populated from settings, api-facts.md fact 20, so this command is
 * the one way to bind a key to a specific action id). `args.node` is honored when a caller supplies
 * one, but a keybinding's `args` is static JSON with no way to name "whatever is selected right
 * now" — so the normal case is `args.node` absent and the node comes from
 * `NodeSelection.currentProjectNode()`, i.e. the tree's current selection at the moment the key was
 * pressed.
 */
export function registerRunActionCommand(
  getRegistry: () => ActionRegistry,
  runner: ActionRunner,
  selection: NodeSelection,
): vscode.Disposable {
  return vscode.commands.registerCommand(RUN_ACTION_COMMAND, async (args: unknown) => {
    if (!isRunActionArgs(args)) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          'projectsTree.runAction requires an { id } argument — bind it from a keybinding\'s "args", not from the Command Palette.',
        ),
      );
      return;
    }
    const node = resolveActionNode(args.node, selection);
    if (node === undefined) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('No project is selected to run action "{0}" on.', args.id),
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

    await runActionById(getRegistry(), runner, args.id, renderNode);
  });
}
