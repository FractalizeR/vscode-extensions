import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(id, handler);
      return {
        dispose: () => {
          // no-op fake disposable
        },
      };
    },
  },
}));

const { registerRefreshCommand, REFRESH_COMMAND } = await import('./refresh.js');

beforeEach(() => {
  registeredHandlers.clear();
});

describe('registerRefreshCommand', () => {
  /**
   * R07-REFRESH: the command used to call only `ProjectsTreeProvider.refresh()`, which never
   * re-reads `projects-tree.rules.json` — a manual edit to the file was invisible until a window
   * reload. Asserting that invoking the command calls the given `reload` pipeline (the same one
   * `extension.ts` runs for a settings change) is what would have caught that regression.
   */
  it('awaits the given reload pipeline, not a narrower refresh', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    registerRefreshCommand(reload);

    await registeredHandlers.get(REFRESH_COMMAND)?.();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('propagates a rejection from reload rather than swallowing it', async () => {
    const failure = new Error('reload failed');
    const reload = vi.fn().mockRejectedValue(failure);
    registerRefreshCommand(reload);

    await expect(registeredHandlers.get(REFRESH_COMMAND)?.()).rejects.toThrow(failure);
  });
});
