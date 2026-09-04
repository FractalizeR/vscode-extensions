import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
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

const { registerRunActionCommand, RUN_ACTION_COMMAND } = await import('./run-action.js');

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

function registryWith(action: ActionDefinition): ActionRegistry {
  return {
    byId: (id) => (id === action.id ? action : undefined),
    applicableTo: () => [],
    ids: () => [],
  };
}

beforeEach(() => {
  registeredHandlers.clear();
  showErrorMessageMock.mockClear();
});

describe('registerRunActionCommand — the keybinding-args entry point', () => {
  it('runs the id and node given explicitly in args, this is the case a keybinding with an inline node uses', async () => {
    const action: ActionDefinition = { id: 'my.action', spec: { kind: 'uri', template: 'x://y' } };
    const runnerRun =
      vi.fn<(action: ActionDefinition, target: ActionRenderNode) => Promise<void>>();
    const runner: ActionRunner = { run: runnerRun };
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };
    registerRunActionCommand(() => registryWith(action), runner, selection);

    await registeredHandlers.get(RUN_ACTION_COMMAND)?.({ id: 'my.action', node: node() });

    expect(runnerRun).toHaveBeenCalledTimes(1);
    expect(runnerRun.mock.calls[0]?.[0].id).toBe('my.action');
  });

  /**
  The keybinding case named in 04-actions.md's package 04-C: a keybinding's `args` is static JSON,
  so it can only ever carry the id — the node has to come from wherever the key was pressed.
  */
  it('falls back to the tree selection when args carries no node — the keybinding case', async () => {
    const action: ActionDefinition = { id: 'my.action', spec: { kind: 'uri', template: 'x://y' } };
    const runnerRun =
      vi.fn<(action: ActionDefinition, target: ActionRenderNode) => Promise<void>>();
    const runner: ActionRunner = { run: runnerRun };
    const selected = node();
    const selection: NodeSelection = {
      currentProjectNode: () => selected,
      currentNode: () => selected,
    };
    registerRunActionCommand(() => registryWith(action), runner, selection);

    await registeredHandlers.get(RUN_ACTION_COMMAND)?.({ id: 'my.action' });

    expect(runnerRun).toHaveBeenCalledTimes(1);
    expect(runnerRun.mock.calls[0]?.[1]).toMatchObject({ path: selected.facts.absolutePath });
  });

  it('reports a clear message when nothing is selected and args carries no node', async () => {
    const action: ActionDefinition = { id: 'my.action', spec: { kind: 'uri', template: 'x://y' } };
    const runner: ActionRunner = { run: vi.fn() };
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };
    registerRunActionCommand(() => registryWith(action), runner, selection);

    await registeredHandlers.get(RUN_ACTION_COMMAND)?.({ id: 'my.action' });

    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessageMock.mock.calls[0]?.[0])).toContain('my.action');
  });

  it.each([[undefined], [{}], [{ id: 42 }], ['a string']])(
    'reports a clear message instead of throwing for a malformed args value: %j',
    async (args) => {
      const runner: ActionRunner = { run: vi.fn() };
      const selection: NodeSelection = {
        currentProjectNode: (): ClassifiedNode | undefined => undefined,
        currentNode: (): ClassifiedNode | undefined => undefined,
      };
      registerRunActionCommand(
        () => registryWith({ id: 'x', spec: { kind: 'uri', template: 'x://y' } }),
        runner,
        selection,
      );

      await registeredHandlers.get(RUN_ACTION_COMMAND)?.(args);
      expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    },
  );
});
