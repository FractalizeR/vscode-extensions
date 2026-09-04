import { describe, expect, it, vi } from 'vitest';
import { RenderError, type ActionRenderNode } from '../../../projects/actions/index.js';

const sendTextMock = vi.fn<(text: string, shouldExecute?: boolean) => void>();
const showMock = vi.fn<() => void>();
const createTerminalMock = vi.fn<(options: Record<string, unknown>) => unknown>(() => ({
  sendText: sendTextMock,
  show: showMock,
}));

vi.mock('vscode', () => ({
  window: { createTerminal: createTerminalMock },
}));

const { runTerminal } = await import('./terminal.js');

function node(path: string): ActionRenderNode {
  return { path, name: 'proj', parentPath: '/work', rootPath: '/work' };
}

describe('runTerminal', () => {
  it('defaults execute to false — sendText is called with shouldExecute: false', () => {
    runTerminal(
      { kind: 'terminal', command: 'echo ${path}', shell: 'zsh' },
      node('/work/my project'),
    );

    expect(sendTextMock).toHaveBeenCalledWith("echo '/work/my project'", false);
  });

  it('execute: true is an explicit opt-in, passed through as shouldExecute: true', () => {
    runTerminal(
      { kind: 'terminal', command: 'echo ${path}', shell: 'zsh', execute: true },
      node('/work/proj'),
    );

    expect(sendTextMock).toHaveBeenCalledWith("echo '/work/proj'", true);
  });

  it('quotes a path containing a space, a semicolon, and a single quote for a POSIX shell', () => {
    runTerminal({ kind: 'terminal', command: 'cd ${path}', shell: 'bash' }, node("/work/a b;c'd"));

    expect(sendTextMock).toHaveBeenCalledWith(String.raw`cd '/work/a b;c'\''d'`, false);
  });

  it('quotes a unicode path unchanged inside single quotes — no metacharacters to escape', () => {
    runTerminal({ kind: 'terminal', command: 'cd ${path}', shell: 'zsh' }, node('/work/проект'));

    expect(sendTextMock).toHaveBeenCalledWith("cd '/work/проект'", false);
  });

  it('rejects a newline in the substituted path instead of inserting it — that would submit early', () => {
    expect(() => {
      runTerminal({ kind: 'terminal', command: 'cd ${path}', shell: 'zsh' }, node('/work/a\nb'));
    }).toThrow(RenderError);
  });

  /**
   * `TerminalOptions.cwd` is a VS Code API parameter, not a shell input — no interpreter ever sees
   * it, so a shell-quoted value (e.g. `"'/work/my project'"`) becomes a directory path with literal
   * quote characters in it and the terminal silently falls back to the home directory. Round-07
   * review (native-claude-01) found `cwd` rendered with the `shell` target instead of `literal`;
   * this test used to assert the broken, quoted value and must fail if that regresses.
   */
  it('passes shellPath and cwd through to createTerminal, cwd rendered as a literal path — never shell-quoted', () => {
    runTerminal(
      {
        kind: 'terminal',
        command: 'opencode',
        shell: 'bash',
        cwd: '${path}',
        terminalName: 'OpenCode',
      },
      node('/work/my project'),
    );

    expect(createTerminalMock).toHaveBeenCalledWith({
      name: 'OpenCode',
      shellPath: 'bash',
      cwd: '/work/my project',
    });
  });

  it('renders terminalName as a literal — a substituted value is inserted as-is, not shell-quoted', () => {
    runTerminal(
      { kind: 'terminal', command: 'echo hi', shell: 'zsh', terminalName: 'Shell: ${name}' },
      { path: '/work/my project', name: 'my project', parentPath: '/work', rootPath: '/work' },
    );

    expect(createTerminalMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Shell: my project' }),
    );
  });

  /**
   * A `\r` in a substituted `terminalName` value is a tab-title spoofing vector (render.ts's
   * control-character rejection exists exactly for this), not merely inert text — `terminalName`
   * must go through `render`, not be passed to `createTerminal` unrendered.
   */
  it('rejects a control character substituted into terminalName', () => {
    expect(() => {
      runTerminal(
        { kind: 'terminal', command: 'echo hi', shell: 'zsh', terminalName: '${name}' },
        { path: '/work/proj', name: 'proj\r evil', parentPath: '/work', rootPath: '/work' },
      );
    }).toThrow(RenderError);
  });

  it('shows the terminal before sending text', () => {
    runTerminal({ kind: 'terminal', command: 'echo hi', shell: 'zsh' }, node('/work/proj'));

    expect(showMock).toHaveBeenCalled();
  });
});
