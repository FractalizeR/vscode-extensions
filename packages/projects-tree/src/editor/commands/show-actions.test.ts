import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ActionDefinition, ActionRenderNode } from '../../projects/actions/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import type { ActionRegistry } from './actions/registry.js';
import type { ActionRunner } from './actions/runner.js';
import type { NodeSelection } from './node-selection.js';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const showErrorMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const showInformationMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const showQuickPickMock = vi.fn<(...args: unknown[]) => unknown>();

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
    showErrorMessage: showErrorMessageMock,
    showInformationMessage: showInformationMessageMock,
    showQuickPick: showQuickPickMock,
  },
  workspace: { workspaceFile: undefined },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

// `toRenderNode` (`actions/render-node.js`) resolves `${rootPath}` through `readRoots()` — the
// fixture nodes below use `/work` as `rootId`, so the fake root must carry that same id.
vi.mock('../configuration/index.js', () => ({
  readRoots: () => ({ roots: [{ id: '/work', path: '/work' }] }),
}));

const { registerShowActionsCommand, SHOW_ACTIONS_COMMAND } = await import('./show-actions.js');

function node(): ClassifiedNode {
  return {
    facts: {
      rootId: '/work',
      absolutePath: '/work/proj',
      pathFromRoot: 'proj',
      name: 'proj',
      depthFromRoot: 1,
      entries: [],
    },
    verdict: DEFAULT_VERDICT,
    children: [],
    entriesRead: true,
  };
}

function registryOf(actions: readonly ActionDefinition[]): ActionRegistry {
  return {
    byId: (id) => actions.find((a) => a.id === id),
    applicableTo: () => actions,
    ids: () => [],
  };
}

beforeEach(() => {
  registeredHandlers.clear();
  showErrorMessageMock.mockClear();
  showInformationMessageMock.mockClear();
  showQuickPickMock.mockClear();
});

describe('registerShowActionsCommand — filters to appliesTo', () => {
  it('offers only the actions registry.applicableTo returns, and runs the one picked', async () => {
    const applicable: ActionDefinition[] = [
      { id: 'a.one', title: 'One', spec: { kind: 'uri', template: 'x://one' } },
      { id: 'a.two', spec: { kind: 'uri', template: 'x://two' } },
    ];
    const runnerRun =
      vi.fn<(action: ActionDefinition, target: ActionRenderNode) => Promise<void>>();
    const runner: ActionRunner = { run: runnerRun };
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };
    showQuickPickMock.mockImplementation((...args: unknown[]) => {
      const items = args[0] as { label: string; action: ActionDefinition }[];
      return Promise.resolve(items.find((item) => item.action.id === 'a.two'));
    });

    registerShowActionsCommand(() => registryOf(applicable), runner, selection);
    await registeredHandlers.get(SHOW_ACTIONS_COMMAND)?.(node());

    const offeredIds = (showQuickPickMock.mock.calls[0]?.[0] as { action: ActionDefinition }[]).map(
      (item) => item.action.id,
    );
    expect(offeredIds).toEqual(['a.one', 'a.two']);
    expect(runnerRun).toHaveBeenCalledTimes(1);
    expect(runnerRun.mock.calls[0]?.[0].id).toBe('a.two');
  });

  it('reports rather than opens a QuickPick when nothing applies', async () => {
    const runner: ActionRunner = { run: vi.fn() };
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };
    registerShowActionsCommand(() => registryOf([]), runner, selection);

    await registeredHandlers.get(SHOW_ACTIONS_COMMAND)?.(node());

    expect(showQuickPickMock).not.toHaveBeenCalled();
    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the QuickPick is dismissed', async () => {
    const runnerRun = vi.fn();
    const runner: ActionRunner = { run: runnerRun };
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };
    showQuickPickMock.mockResolvedValue(undefined);

    registerShowActionsCommand(
      () => registryOf([{ id: 'a.one', spec: { kind: 'uri', template: 'x://one' } }]),
      runner,
      selection,
    );
    await registeredHandlers.get(SHOW_ACTIONS_COMMAND)?.(node());

    expect(runnerRun).not.toHaveBeenCalled();
  });
});
