import * as vscode from 'vscode';
import {
  renderCommandArgs,
  type ActionRenderNode,
  type ActionSpec,
} from '../../../projects/actions/index.js';

export type VscodeCommandSpec = Extract<ActionSpec, { kind: 'command' }>;

/**
 * `args` is rendered like any other sink (`renderCommandArgs`, projects/actions/render.ts) — a
 * string element is template-substituted, anything else passes through untouched. `commandId`
 * itself is never a template: it is fixed by the action's author, not user-controlled data.
 */
export async function runVscodeCommand(
  spec: VscodeCommandSpec,
  node: ActionRenderNode,
): Promise<void> {
  const args = spec.args === undefined ? [] : renderCommandArgs(spec.args, node);
  await vscode.commands.executeCommand(spec.commandId, ...args);
}
