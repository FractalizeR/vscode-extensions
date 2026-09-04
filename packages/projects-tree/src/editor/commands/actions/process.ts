import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import {
  renderArgs,
  type ActionRenderNode,
  type ActionSpec,
} from '../../../projects/actions/index.js';

export type ProcessSpec = Extract<ActionSpec, { kind: 'process' }>;

const SHELL_WRAPPER_EXTENSIONS = ['.cmd', '.bat'];

/**
 * Launches `spec.command` directly, detached, with no shell in between (api-facts.md, fact 25:
 * `.cmd`/`.bat` cannot run this way at all on Windows, so such a target is rejected up front rather
 * than attempted and left to fail silently or confusingly).
 *
 * Resolved by two Node events, not a timeout or an exit code (api-facts.md, facts 68-69): `'spawn'`
 * fires only on a successful launch and always before any other event, `'error'` fires instead when
 * the process could not be spawned at all (the ENOENT case — command not on `PATH`). `unref()` is
 * called only after `'spawn'`, once a real child process is known to exist — calling it before that
 * has nothing to detach from.
 */
export function runProcess(spec: ProcessSpec, node: ActionRenderNode): Promise<void> {
  if (isShellWrapperTarget(spec.command)) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t(
        '"{0}" is a .cmd/.bat file and cannot be launched without a shell on Windows — declare this as a "terminal" action instead.',
        spec.command,
      ),
    );
    return Promise.resolve();
  }

  // `render`'s control-character/RenderError checks still apply per element (projects/actions/
  // render.ts's doc comment on renderArgs) — a thrown RenderError here propagates to the caller
  // (runner.ts), which is where every action kind's RenderError is reported.
  const args = renderArgs(spec.args, node);

  return new Promise((resolve) => {
    const child = spawn(spec.command, args, { detached: true, stdio: 'ignore' });
    child.once('error', (error) => {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Could not start "{0}": {1}', spec.command, error.message),
      );
      resolve();
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    // A successful spawn followed by an immediate non-zero exit (the target binary itself
    // failing right away — a missing shared library, a bad argument) is silent otherwise:
    // `stdio: 'ignore'` means this executor never sees the child's own stderr, so a code is the
    // only signal left. Not tied to the resolved `Promise` above — it can fire well after this
    // function has already returned, since the child keeps running detached.
    child.once('exit', (code) => {
      if (code !== null && code !== 0) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t('"{0}" exited with code {1}.', spec.command, String(code)),
        );
      }
    });
  });
}

function isShellWrapperTarget(command: string): boolean {
  const lower = command.toLowerCase();
  return SHELL_WRAPPER_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
