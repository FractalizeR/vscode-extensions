import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const showWarningMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const showErrorMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const showQuickPickMock = vi.fn<(...args: unknown[]) => unknown>();
const showInformationMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const updateMock = vi.fn<(...args: unknown[]) => unknown>();
const getConfigurationMock = vi.fn(() => ({ update: updateMock }));

// `configuration/index.js`'s `readRoots` reads `vscode.workspace.getConfiguration(...).get(...)` —
// mocked here directly rather than through the real module, since `roots.ts` is the file under
// test, not `configuration/`.
const rootsMock = {
  roots: [
    { id: '/a', path: '/a' },
    { id: '/b', path: '/b', label: 'Beta' },
  ],
};
vi.mock('../configuration/index.js', () => ({ readRoots: () => rootsMock }));

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
  window: {
    showWarningMessage: showWarningMessageMock,
    showErrorMessage: showErrorMessageMock,
    showQuickPick: showQuickPickMock,
    showInformationMessage: showInformationMessageMock,
    showOpenDialog: vi.fn(),
  },
  workspace: { getConfiguration: getConfigurationMock },
  ConfigurationTarget: { Global: 1 },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { registerRemoveRootCommand, REMOVE_ROOT_COMMAND } = await import('./roots.js');

interface RootQuickPickItem {
  readonly label: string;
  readonly rootId: string;
}

beforeEach(() => {
  registeredHandlers.clear();
  showWarningMessageMock.mockClear();
  showErrorMessageMock.mockClear();
  showQuickPickMock.mockClear();
  showInformationMessageMock.mockClear();
  updateMock.mockClear();
  getConfigurationMock.mockClear();
});

describe('registerRemoveRootCommand — invoked without a RootGroupArg (Command Palette, or no rootGroup node exists)', () => {
  /**
   * R07-REMOVE-ROOT: a `rootGroup` context-menu item does not exist at all for a single root under
   * `showRootNodes: "auto"`, nor for any root count under `"never"` — the Command Palette is then
   * the only way to reach this command, and it always calls with no argument. The old behaviour
   * (immediately showing an error) made Remove Root unreachable in exactly those configurations;
   * the fix offers a QuickPick over the configured roots instead.
   */
  it('offers every configured root in a QuickPick and removes the one picked', async () => {
    registerRemoveRootCommand();
    showQuickPickMock.mockImplementation((...args: unknown[]) => {
      const items = args[0] as RootQuickPickItem[];
      return Promise.resolve(items.find((item) => item.rootId === '/b'));
    });
    showWarningMessageMock.mockImplementation((...args: unknown[]) => Promise.resolve(args[2]));

    await registeredHandlers.get(REMOVE_ROOT_COMMAND)?.();

    const offered = showQuickPickMock.mock.calls[0]?.[0] as RootQuickPickItem[];
    expect(offered.map((item) => item.rootId)).toEqual(['/a', '/b']);
    expect(showErrorMessageMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, value] = updateMock.mock.calls[0] as [string, unknown];
    expect(value).toEqual(['/a']);
  });

  it('does nothing when the QuickPick is dismissed', async () => {
    registerRemoveRootCommand();
    showQuickPickMock.mockResolvedValue(undefined);

    await registeredHandlers.get(REMOVE_ROOT_COMMAND)?.();

    expect(showWarningMessageMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('reports rather than shows an empty QuickPick when no roots are configured', async () => {
    rootsMock.roots = [];
    registerRemoveRootCommand();

    await registeredHandlers.get(REMOVE_ROOT_COMMAND)?.();

    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
    expect(showQuickPickMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    rootsMock.roots = [
      { id: '/a', path: '/a' },
      { id: '/b', path: '/b', label: 'Beta' },
    ];
  });
});

describe('registerRemoveRootCommand', () => {
  it('asks for modal confirmation before writing anything', async () => {
    registerRemoveRootCommand();
    showWarningMessageMock.mockResolvedValue(undefined); // dismissed / declined

    await registeredHandlers.get(REMOVE_ROOT_COMMAND)?.({ rootId: '/a', label: '/a' });

    expect(showWarningMessageMock).toHaveBeenCalledTimes(1);
    const options = showWarningMessageMock.mock.calls[0]?.[1] as { modal?: boolean };
    expect(options.modal).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('removes exactly the confirmed root, keeping every other entry (including labels) intact', async () => {
    registerRemoveRootCommand();
    showWarningMessageMock.mockImplementation((...args: unknown[]) => Promise.resolve(args[2]));

    await registeredHandlers.get(REMOVE_ROOT_COMMAND)?.({ rootId: '/a', label: '/a' });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [key, value, target] = updateMock.mock.calls[0] as [string, unknown, unknown];
    expect(key).toBe('roots');
    expect(value).toEqual([{ path: '/b', label: 'Beta' }]);
    expect(target).toBe(1); // ConfigurationTarget.Global — scope: machine (api-facts.md, fact 18)
  });
});
