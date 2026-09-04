import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderError, type ActionRenderNode } from '../../../projects/actions/index.js';

type Listener = (...args: unknown[]) => void;

/**
 * Hand-rolled instead of `node:events`'s `EventEmitter` — same choice `decoration-provider.test.ts`
 * makes for its own fake, and enough for the two events (`'spawn'`/`'error'`/`'exit'`) `process.ts`
 * listens to.
 */
class FakeChildProcess {
  #listeners = new Map<string, Listener[]>();
  unref = vi.fn();

  once(event: string, listener: Listener): void {
    const list = this.#listeners.get(event) ?? [];
    list.push(listener);
    this.#listeners.set(event, list);
  }

  emit(event: string, ...args: unknown[]): void {
    const listeners = this.#listeners.get(event) ?? [];
    for (const listener of listeners) listener(...args);
  }
}

const state: { lastChild: FakeChildProcess } = { lastChild: new FakeChildProcess() };
const spawnMock = vi.fn<(command: string, args: readonly string[], options: unknown) => unknown>(
  () => {
    state.lastChild = new FakeChildProcess();
    return state.lastChild;
  },
);
const showErrorMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const showWarningMessageMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('vscode', () => ({
  window: {
    showErrorMessage: showErrorMessageMock,
    showWarningMessage: showWarningMessageMock,
  },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { runProcess } = await import('./process.js');

function node(path: string): ActionRenderNode {
  return { path, name: 'proj', parentPath: '/work', rootPath: '/work' };
}

beforeEach(() => {
  spawnMock.mockClear();
  showErrorMessageMock.mockClear();
  showWarningMessageMock.mockClear();
});

describe('runProcess', () => {
  it('spawns detached with stdio ignored and unrefs on a successful spawn', async () => {
    const promise = runProcess(
      { kind: 'process', command: 'phpstorm', args: ['${path}'] },
      node('/work/proj'),
    );
    state.lastChild.emit('spawn');
    await promise;

    expect(spawnMock).toHaveBeenCalledWith('phpstorm', ['/work/proj'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(state.lastChild.unref).toHaveBeenCalledTimes(1);
    expect(showErrorMessageMock).not.toHaveBeenCalled();
  });

  it('reports "command not found" (ENOENT) instead of failing silently', async () => {
    const promise = runProcess(
      { kind: 'process', command: 'no-such-binary', args: [] },
      node('/work/proj'),
    );
    state.lastChild.emit(
      'error',
      Object.assign(new Error('spawn no-such-binary ENOENT'), { code: 'ENOENT' }),
    );
    await promise;

    expect(state.lastChild.unref).not.toHaveBeenCalled();
    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    expect(showErrorMessageMock.mock.calls[0]?.[0]).toContain('no-such-binary');
  });

  it('reports an immediate non-zero exit after a successful spawn, not silence', async () => {
    const promise = runProcess({ kind: 'process', command: 'flaky', args: [] }, node('/work/proj'));
    state.lastChild.emit('spawn');
    await promise;
    state.lastChild.emit('exit', 127, null);

    expect(showWarningMessageMock).toHaveBeenCalledTimes(1);
    expect(showWarningMessageMock.mock.calls[0]?.[0]).toContain('127');
  });

  it('a clean (code 0) exit is not reported', async () => {
    const promise = runProcess({ kind: 'process', command: 'ok', args: [] }, node('/work/proj'));
    state.lastChild.emit('spawn');
    await promise;
    state.lastChild.emit('exit', 0, null);

    expect(showWarningMessageMock).not.toHaveBeenCalled();
  });

  it('rejects a .cmd target with a clear message and never spawns it (fact 25)', async () => {
    await runProcess({ kind: 'process', command: 'phpstorm.cmd', args: [] }, node('/work/proj'));

    expect(spawnMock).not.toHaveBeenCalled();
    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    expect(showErrorMessageMock.mock.calls[0]?.[0]).toContain('phpstorm.cmd');
  });

  it('rejects a .bat target the same way, case-insensitively', async () => {
    await runProcess({ kind: 'process', command: 'RUN.BAT', args: [] }, node('/work/proj'));

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('renders each arg (space, quote, unicode) as a literal — no shell, so no quoting needed', async () => {
    const promise = runProcess(
      { kind: 'process', command: 'phpstorm', args: ['${path}', 'проект', 'a "b"'] },
      node('/work/my project'),
    );
    state.lastChild.emit('spawn');
    await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      'phpstorm',
      ['/work/my project', 'проект', 'a "b"'],
      expect.anything(),
    );
  });

  it('throws RenderError synchronously for a newline in a substituted arg, before spawning', () => {
    expect(() =>
      runProcess({ kind: 'process', command: 'phpstorm', args: ['${path}'] }, node('/work/a\nb')),
    ).toThrow(RenderError);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
