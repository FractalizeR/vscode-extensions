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

const { registerRunPrimaryActionCommand, RUN_PRIMARY_ACTION_COMMAND } =
  await import('./run-primary-action.js');

function node(overrides: Partial<ClassifiedNode['verdict']> = {}): ClassifiedNode {
  return {
    facts: {
      rootId: '/work',
      absolutePath: '/work/proj',
      pathFromRoot: 'proj',
      name: 'proj',
      depthFromRoot: 1,
      entries: [],
    },
    verdict: { ...DEFAULT_VERDICT, ...overrides },
    children: [],
    entriesRead: true,
  };
}

function noSelection(): NodeSelection {
  return {
    currentProjectNode: (): ClassifiedNode | undefined => undefined,
    currentNode: (): ClassifiedNode | undefined => undefined,
  };
}

function selectionOf(selected: ClassifiedNode): NodeSelection {
  return { currentProjectNode: () => selected, currentNode: () => selected };
}

beforeEach(() => {
  registeredHandlers.clear();
  showErrorMessageMock.mockClear();
});

describe('registerRunPrimaryActionCommand — primary action resolution chain', () => {
  it("runs the id named by the node's verdict.primaryAction, ignoring the default", async () => {
    const runnerRun =
      vi.fn<(action: ActionDefinition, target: ActionRenderNode) => Promise<void>>();
    const runner: ActionRunner = { run: runnerRun };
    const registry: ActionRegistry = {
      byId: (id) =>
        id === 'from.rule' ? { id, spec: { kind: 'uri', template: 'x://y' } } : undefined,
      applicableTo: () => [],
      ids: () => ['from.rule'],
    };
    registerRunPrimaryActionCommand(
      () => registry,
      runner,
      noSelection(),
      () => 'from.default',
    );

    const target = node({ primaryAction: { value: 'from.rule', byRule: 'r' } });
    await registeredHandlers.get(RUN_PRIMARY_ACTION_COMMAND)?.(target);

    expect(runnerRun).toHaveBeenCalledTimes(1);
    expect(runnerRun.mock.calls[0]?.[0].id).toBe('from.rule');
  });

  it('falls back to projectsTree.defaultAction when the verdict names none', async () => {
    const runnerRun =
      vi.fn<(action: ActionDefinition, target: ActionRenderNode) => Promise<void>>();
    const runner: ActionRunner = { run: runnerRun };
    const registry: ActionRegistry = {
      byId: (id) =>
        id === 'from.default' ? { id, spec: { kind: 'uri', template: 'x://y' } } : undefined,
      applicableTo: () => [],
      ids: () => ['from.default'],
    };
    registerRunPrimaryActionCommand(
      () => registry,
      runner,
      noSelection(),
      () => 'from.default',
    );

    await registeredHandlers.get(RUN_PRIMARY_ACTION_COMMAND)?.(node());

    expect(runnerRun).toHaveBeenCalledTimes(1);
    expect(runnerRun.mock.calls[0]?.[0].id).toBe('from.default');
  });

  /**
  A rule can reference an id nothing declares (validation upstream should have caught it, but the
  executor must survive a rules-file/registry rebuild race — `runActionById`'s own doc comment).
  Shows a message, never throws.
  */
  it('reports a clear message, not an exception, when the resolved id is unknown', async () => {
    const runner: ActionRunner = { run: vi.fn() };
    const registry: ActionRegistry = {
      byId: (): ActionDefinition | undefined => undefined,
      applicableTo: () => [],
      ids: () => [],
    };
    registerRunPrimaryActionCommand(
      () => registry,
      runner,
      noSelection(),
      () => 'ghost.default',
    );

    await registeredHandlers.get(RUN_PRIMARY_ACTION_COMMAND)?.(node());

    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    expect(String(showErrorMessageMock.mock.calls[0]?.[0])).toContain('ghost.default');
  });

  it('falls back to the tree selection when invoked with no explicit node', async () => {
    const runnerRun =
      vi.fn<(action: ActionDefinition, target: ActionRenderNode) => Promise<void>>();
    const runner: ActionRunner = { run: runnerRun };
    const registry: ActionRegistry = {
      byId: (id) => ({ id, spec: { kind: 'uri', template: 'x://y' } }),
      applicableTo: () => [],
      ids: () => [],
    };
    const selected = node({ primaryAction: { value: 'selected.action', byRule: 'r' } });
    registerRunPrimaryActionCommand(
      () => registry,
      runner,
      selectionOf(selected),
      () => 'from.default',
    );

    await registeredHandlers.get(RUN_PRIMARY_ACTION_COMMAND)?.();

    expect(runnerRun.mock.calls[0]?.[0].id).toBe('selected.action');
  });

  it('reports a clear message when neither an explicit node nor a selection is available', async () => {
    const runner: ActionRunner = { run: vi.fn() };
    const registry: ActionRegistry = {
      byId: (): ActionDefinition | undefined => undefined,
      applicableTo: () => [],
      ids: () => [],
    };
    registerRunPrimaryActionCommand(
      () => registry,
      runner,
      noSelection(),
      () => 'from.default',
    );

    await registeredHandlers.get(RUN_PRIMARY_ACTION_COMMAND)?.();

    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
  });
});
