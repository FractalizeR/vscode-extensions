import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRenderNode } from '../../../projects/actions/index.js';

const readdirMock = vi.fn<(dirPath: string) => Promise<string[]>>();
const executeCommandMock = vi.fn<(...args: unknown[]) => unknown>();
const showErrorMessageMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('node:fs/promises', () => ({ readdir: readdirMock }));
vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath, toString: () => `file://${fsPath}` }) },
  commands: { executeCommand: executeCommandMock },
  workspace: { workspaceFolders: undefined },
  window: { showErrorMessage: showErrorMessageMock },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { runOpenFolder } = await import('./open-folder.js');

function node(path: string): ActionRenderNode {
  return { path, name: 'proj', parentPath: '/work', rootPath: '/work' };
}

beforeEach(() => {
  readdirMock.mockReset();
  executeCommandMock.mockReset();
  showErrorMessageMock.mockReset();
});

describe('runOpenFolder', () => {
  it('opens the project folder itself when it has no .code-workspace file', async () => {
    readdirMock.mockResolvedValue(['src', 'package.json']);

    await runOpenFolder({ kind: 'openFolder', window: 'new' }, node('/work/proj'));

    expect(executeCommandMock).toHaveBeenCalledWith(
      'vscode.openFolder',
      expect.objectContaining({ fsPath: '/work/proj' }),
      { forceNewWindow: true },
    );
  });

  it('opens the .code-workspace file instead of the folder — prototype behavior', async () => {
    readdirMock.mockResolvedValue(['src', 'a.code-workspace']);

    await runOpenFolder({ kind: 'openFolder', window: 'new' }, node('/work/proj'));

    expect(executeCommandMock).toHaveBeenCalledWith(
      'vscode.openFolder',
      expect.objectContaining({ fsPath: '/work/proj/a.code-workspace' }),
      expect.anything(),
    );
  });

  it('window: "new" forces a new window', async () => {
    readdirMock.mockResolvedValue([]);

    await runOpenFolder({ kind: 'openFolder', window: 'new' }, node('/work/proj'));

    expect(executeCommandMock).toHaveBeenCalledWith('vscode.openFolder', expect.anything(), {
      forceNewWindow: true,
    });
  });

  it('window: "current" reuses the current window — the one caller-visible sign of fact 10\'s extension-host restart', async () => {
    readdirMock.mockResolvedValue([]);

    await runOpenFolder({ kind: 'openFolder', window: 'current' }, node('/work/proj'));

    expect(executeCommandMock).toHaveBeenCalledWith('vscode.openFolder', expect.anything(), {
      forceNewWindow: false,
    });
  });

  it('reports a clear error and opens nothing when the project directory no longer exists', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
      code: 'ENOENT',
    });
    readdirMock.mockRejectedValue(enoent);

    await runOpenFolder({ kind: 'openFolder', window: 'new' }, node('/work/gone'));

    expect(executeCommandMock).not.toHaveBeenCalled();
    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    expect(showErrorMessageMock.mock.calls[0]?.[0]).toContain('/work/gone');
  });
});

describe('runOpenFolder — window: "auto"', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('opens a new window when the current window already has a folder open', async () => {
    vi.doMock('node:fs/promises', () => ({ readdir: () => Promise.resolve([]) }));
    vi.doMock('vscode', () => ({
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      commands: { executeCommand: executeCommandMock },
      workspace: { workspaceFolders: [{ uri: { fsPath: '/already/open' } }] },
      window: { showErrorMessage: showErrorMessageMock },
      l10n: { t: (message: string) => message },
    }));
    executeCommandMock.mockReset();
    const { runOpenFolder: freshRun } = await import('./open-folder.js');

    await freshRun({ kind: 'openFolder', window: 'auto' }, node('/work/proj'));

    expect(executeCommandMock).toHaveBeenCalledWith('vscode.openFolder', expect.anything(), {
      forceNewWindow: true,
    });
  });

  it('reuses the current (empty) window when nothing is open yet', async () => {
    vi.doMock('node:fs/promises', () => ({ readdir: () => Promise.resolve([]) }));
    vi.doMock('vscode', () => ({
      Uri: { file: (fsPath: string) => ({ fsPath }) },
      commands: { executeCommand: executeCommandMock },
      workspace: { workspaceFolders: undefined },
      window: { showErrorMessage: showErrorMessageMock },
      l10n: { t: (message: string) => message },
    }));
    executeCommandMock.mockReset();
    const { runOpenFolder: freshRun } = await import('./open-folder.js');

    await freshRun({ kind: 'openFolder', window: 'auto' }, node('/work/proj'));

    expect(executeCommandMock).toHaveBeenCalledWith('vscode.openFolder', expect.anything(), {
      forceNewWindow: false,
    });
  });
});
