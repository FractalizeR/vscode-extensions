import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RenderError,
  type ActionDefinition,
  type ActionRenderNode,
} from '../../../projects/actions/index.js';
import type { ActionRegistry } from './registry.js';
import type { ExecutionDecision, ExecutionGate } from './runner.js';

const runOpenFolderMock = vi.fn<(...args: unknown[]) => unknown>().mockResolvedValue(undefined);
const runTerminalMock = vi.fn<(...args: unknown[]) => unknown>();
const runProcessMock = vi.fn<(...args: unknown[]) => unknown>().mockResolvedValue(undefined);
const runUriMock = vi.fn<(...args: unknown[]) => unknown>().mockResolvedValue(undefined);
const runVscodeCommandMock = vi.fn<(...args: unknown[]) => unknown>().mockResolvedValue(undefined);
const showErrorMessageMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('./open-folder.js', () => ({ runOpenFolder: runOpenFolderMock }));
vi.mock('./terminal.js', () => ({ runTerminal: runTerminalMock }));
vi.mock('./process.js', () => ({ runProcess: runProcessMock }));
vi.mock('./uri.js', () => ({ runUri: runUriMock }));
vi.mock('./vscode-command.js', () => ({ runVscodeCommand: runVscodeCommandMock }));
vi.mock('vscode', () => ({
  window: { showErrorMessage: showErrorMessageMock },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { createActionRunner, runActionById } = await import('./runner.js');

function node(): ActionRenderNode {
  return { path: '/work/proj', name: 'proj', parentPath: '/work', rootPath: '/work' };
}

function allow(): ExecutionGate {
  return { check: () => Promise.resolve({ allowed: true }) };
}

function deny(message: string): ExecutionGate {
  return {
    check: () => Promise.resolve({ allowed: false, message }),
  };
}

function registryWith(action: ActionDefinition | undefined): ActionRegistry {
  return {
    byId: () => action,
    applicableTo: () => [],
    ids: () => (action === undefined ? [] : [action.id]),
  };
}

beforeEach(() => {
  runOpenFolderMock.mockClear();
  runTerminalMock.mockClear();
  runProcessMock.mockClear();
  runUriMock.mockClear();
  runVscodeCommandMock.mockClear();
  showErrorMessageMock.mockClear();
});

describe('createActionRunner — dispatch by kind', () => {
  it('dispatches openFolder without consulting the gate', async () => {
    const gateCheck = vi.fn<() => Promise<ExecutionDecision>>().mockResolvedValue({
      allowed: true,
    });
    const runner = createActionRunner({ check: gateCheck });

    await runner.run({ id: 'a', spec: { kind: 'openFolder', window: 'new' } }, node());

    expect(runOpenFolderMock).toHaveBeenCalledTimes(1);
    expect(gateCheck).not.toHaveBeenCalled();
  });

  it('dispatches uri without consulting the gate', async () => {
    const gateCheck = vi.fn<() => Promise<ExecutionDecision>>().mockResolvedValue({
      allowed: true,
    });
    const runner = createActionRunner({ check: gateCheck });

    await runner.run({ id: 'a', spec: { kind: 'uri', template: 'x://y' } }, node());

    expect(runUriMock).toHaveBeenCalledTimes(1);
    expect(gateCheck).not.toHaveBeenCalled();
  });

  it.each([
    [
      'terminal',
      { kind: 'terminal', command: 'echo hi', shell: 'zsh' } as const,
      () => runTerminalMock,
    ],
    ['process', { kind: 'process', command: 'phpstorm', args: [] } as const, () => runProcessMock],
    ['command', { kind: 'command', commandId: 'my.command' } as const, () => runVscodeCommandMock],
  ] as const)('runs %s once the gate allows it', async (_label, spec, getExecutorMock) => {
    const runner = createActionRunner(allow());

    await runner.run({ id: 'a', spec }, node());

    expect(getExecutorMock()).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'terminal',
      { kind: 'terminal', command: 'echo hi', shell: 'zsh' } as const,
      () => runTerminalMock,
    ],
    ['process', { kind: 'process', command: 'phpstorm', args: [] } as const, () => runProcessMock],
    ['command', { kind: 'command', commandId: 'my.command' } as const, () => runVscodeCommandMock],
  ] as const)(
    "a gate denial for %s blocks execution and shows the gate's message",
    async (_label, spec, getExecutorMock) => {
      const runner = createActionRunner(deny('Untrusted workspace.'));

      await runner.run({ id: 'a', spec }, node());

      expect(getExecutorMock()).not.toHaveBeenCalled();
      expect(showErrorMessageMock).toHaveBeenCalledWith('Untrusted workspace.');
    },
  );
});

describe('createActionRunner — RenderError handling', () => {
  it('catches a RenderError from an executor and shows a localized message instead of throwing', async () => {
    // R07-L10N-BYPASS: RenderError.message is an English diagnostic built in the vscode-free core —
    // it must never reach the user as-is; the runner localizes by `reason` instead.
    runUriMock.mockRejectedValueOnce(new RenderError('unknownVariable', 'bad template'));
    const runner = createActionRunner(allow());

    await runner.run({ id: 'a', spec: { kind: 'uri', template: 'x://${bogus}' } }, node());

    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    const [shown] = showErrorMessageMock.mock.calls[0] as [string];
    expect(shown).not.toBe('bad template');
    expect(shown.length).toBeGreaterThan(0);
  });

  it.each(['unknownVariable', 'missingValue', 'controlCharacterInValue', 'unsafeValue'] as const)(
    'shows a distinct, non-empty localized message for reason %s',
    async (reason) => {
      runUriMock.mockRejectedValueOnce(new RenderError(reason, 'irrelevant english detail'));
      const runner = createActionRunner(allow());

      await runner.run({ id: 'a', spec: { kind: 'uri', template: 'x://${bogus}' } }, node());

      const [shown] = showErrorMessageMock.mock.calls[0] as [string];
      expect(shown).not.toBe('irrelevant english detail');
      expect(shown.length).toBeGreaterThan(0);
      showErrorMessageMock.mockClear();
    },
  );

  it("re-throws an error that is not a RenderError — only RenderError is this function's business", async () => {
    runUriMock.mockRejectedValueOnce(new Error('unexpected'));
    const runner = createActionRunner(allow());

    await expect(
      runner.run({ id: 'a', spec: { kind: 'uri', template: 'x://y' } }, node()),
    ).rejects.toThrow('unexpected');
  });
});

describe('runActionById', () => {
  it('resolves the id through the registry and runs the resolved action', async () => {
    const action: ActionDefinition = { id: 'a', spec: { kind: 'uri', template: 'x://y' } };
    const runner = {
      run: vi.fn<(action: ActionDefinition, node: ActionRenderNode) => Promise<void>>(),
    };
    runner.run.mockResolvedValue(undefined);

    await runActionById(registryWith(action), runner, 'a', node());

    expect(runner.run).toHaveBeenCalledWith(action, node());
  });

  it('survives a primaryAction referencing an id nothing declares — shows a message, does not throw', async () => {
    const runner = {
      run: vi.fn<(action: ActionDefinition, node: ActionRenderNode) => Promise<void>>(),
    };

    await runActionById(registryWith(undefined), runner, 'ghost.action', node());

    expect(runner.run).not.toHaveBeenCalled();
    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    expect(showErrorMessageMock.mock.calls[0]?.[0]).toContain('ghost.action');
  });
});
