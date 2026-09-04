import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import { BUILT_IN_ACTIONS } from '../../projects/actions/index.js';
import type { ActionDefinition, ActionRenderNode } from '../../projects/actions/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import type { ActionRegistry } from './actions/registry.js';
import type { ActionRunner } from './actions/runner.js';
import type { NodeSelection } from './node-selection.js';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const showErrorMessageMock = vi.fn<(...args: unknown[]) => unknown>();

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
  window: { showErrorMessage: showErrorMessageMock },
  workspace: { workspaceFile: undefined },
  l10n: { t: (message: string) => message },
}));

// `toRenderNode` (`actions/render-node.js`) resolves `${rootPath}` through `readRoots()` — the
// fixture nodes below use `/work` as `rootId`, so the fake root must carry that same id.
vi.mock('../configuration/index.js', () => ({
  readRoots: () => ({ roots: [{ id: '/work', path: '/work' }] }),
}));

const { registerOpenInWindowCommands, OPEN_IN_NEW_WINDOW_COMMAND, OPEN_IN_CURRENT_WINDOW_COMMAND } =
  await import('./open-in-window.js');

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

function builtInRegistry(): ActionRegistry {
  return {
    byId: (id) => BUILT_IN_ACTIONS.find((action) => action.id === id),
    applicableTo: () => BUILT_IN_ACTIONS,
    ids: () => BUILT_IN_ACTIONS.map((action) => action.id),
  };
}

beforeEach(() => {
  registeredHandlers.clear();
  showErrorMessageMock.mockClear();
});

describe('registerOpenInWindowCommands', () => {
  it('runs builtin.openInNewWindow for the new-window command', async () => {
    const runnerRun =
      vi.fn<(action: ActionDefinition, target: ActionRenderNode) => Promise<void>>();
    const runner: ActionRunner = { run: runnerRun };
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };
    registerOpenInWindowCommands(builtInRegistry, runner, selection);

    await registeredHandlers.get(OPEN_IN_NEW_WINDOW_COMMAND)?.(node());

    expect(runnerRun.mock.calls[0]?.[0].id).toBe('builtin.openInNewWindow');
  });

  it('runs builtin.openInCurrentWindow for the current-window command', async () => {
    const runnerRun =
      vi.fn<(action: ActionDefinition, target: ActionRenderNode) => Promise<void>>();
    const runner: ActionRunner = { run: runnerRun };
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };
    registerOpenInWindowCommands(builtInRegistry, runner, selection);

    await registeredHandlers.get(OPEN_IN_CURRENT_WINDOW_COMMAND)?.(node());

    expect(runnerRun.mock.calls[0]?.[0].id).toBe('builtin.openInCurrentWindow');
  });

  it('reports rather than throws when nothing is selected', async () => {
    const runner: ActionRunner = { run: vi.fn() };
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };
    registerOpenInWindowCommands(builtInRegistry, runner, selection);

    await registeredHandlers.get(OPEN_IN_NEW_WINDOW_COMMAND)?.();

    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
  });
});
