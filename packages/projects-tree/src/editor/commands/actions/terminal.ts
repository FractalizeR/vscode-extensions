import * as vscode from 'vscode';
import {
  render,
  type ActionRenderNode,
  type ActionSpec,
  type ShellKind,
} from '../../../projects/actions/index.js';

export type TerminalSpec = Extract<ActionSpec, { kind: 'terminal' }>;

/**
 * `ShellKind` (`terminal.shell`) names a quoting dialect, not a path — `TerminalOptions.shellPath`
 * (api-facts.md, fact 65) wants an executable. These are the bare executable names for each dialect;
 * resolving a bare name against `PATH` is `createTerminal`'s job (the same trust `process.ts` places
 * in `spawn` resolving `command` — neither this codebase nor its facts claim a `PATH`-lookup
 * guarantee, they rely on the platform's ordinary "unqualified executable name" behavior). `cmd.exe`
 * over the bare `cmd`: the qualified name is unambiguous on the one platform (`cmd`'s quoting rules)
 * where this matters.
 */
const SHELL_EXECUTABLE: Record<ShellKind, string> = {
  zsh: 'zsh',
  bash: 'bash',
  powershell: 'powershell',
  cmd: 'cmd.exe',
};

/**
 * `execute: false` by default (api-facts.md, fact 11 — enforced by `ActionSpec.terminal.execute`'s
 * own default, not re-decided here) is why this codebase's threat model treats `terminal` as safer
 * than it looks: the rendered command lands in the terminal but is not run until the user presses
 * Enter. Never reuses an existing `Terminal` (00-overview.md's plan text rules it out expressly) —
 * every call gets its own, created with the shell and `cwd` the action declared.
 */
export function runTerminal(spec: TerminalSpec, node: ActionRenderNode): void {
  const shellTarget = { kind: 'shell', shell: spec.shell } as const;
  const literalTarget = { kind: 'literal' } as const;
  const command = render(spec.command, node, shellTarget);
  // `cwd`/`terminalName` reach `TerminalOptions`, a VS Code API parameter — never a shell — so
  // shell-quoting them would put literal quote characters into the value (action.ts's doc comment
  // on `cwd`).
  const cwd = spec.cwd === undefined ? undefined : render(spec.cwd, node, literalTarget);
  const terminalName =
    spec.terminalName === undefined ? undefined : render(spec.terminalName, node, literalTarget);

  const terminal = vscode.window.createTerminal({
    ...(terminalName !== undefined && { name: terminalName }),
    shellPath: SHELL_EXECUTABLE[spec.shell],
    ...(cwd !== undefined && { cwd }),
  });
  terminal.show();
  terminal.sendText(command, spec.execute ?? false);
}
