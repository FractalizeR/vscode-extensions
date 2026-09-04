import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderError, type ActionRenderNode } from '../../../projects/actions/index.js';

const executeCommandMock = vi.fn<(...args: unknown[]) => unknown>().mockResolvedValue(undefined);

vi.mock('vscode', () => ({
  commands: { executeCommand: executeCommandMock },
}));

const { runVscodeCommand } = await import('./vscode-command.js');

function node(path: string): ActionRenderNode {
  return { path, name: 'proj', parentPath: '/work', rootPath: '/work' };
}

beforeEach(() => {
  executeCommandMock.mockClear();
});

describe('runVscodeCommand', () => {
  it('calls executeCommand with the fixed commandId and no args when none are declared', async () => {
    await runVscodeCommand({ kind: 'command', commandId: 'my.command' }, node('/work/proj'));

    expect(executeCommandMock).toHaveBeenCalledWith('my.command');
  });

  it('renders string args as literals and passes non-string args through untouched', async () => {
    await runVscodeCommand(
      { kind: 'command', commandId: 'my.command', args: ['${path}', 42, true, { a: 1 }] },
      node('/work/my project'),
    );

    expect(executeCommandMock).toHaveBeenCalledWith('my.command', '/work/my project', 42, true, {
      a: 1,
    });
  });

  it('rejects a newline in a substituted arg before calling executeCommand', async () => {
    await expect(
      runVscodeCommand(
        { kind: 'command', commandId: 'my.command', args: ['${path}'] },
        node('/work/a\nb'),
      ),
    ).rejects.toThrow(RenderError);
    expect(executeCommandMock).not.toHaveBeenCalled();
  });
});
