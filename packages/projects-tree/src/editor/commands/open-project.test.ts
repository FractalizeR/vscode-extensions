import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirEntry } from '../../projects/classification/index.js';
import type { ClassifiedNode, FileSystemReader } from '../../projects/discovery/index.js';
import type { ConfiguredRoot } from '../configuration/index.js';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const showInformationMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const showQuickPickMock = vi.fn<(...args: unknown[]) => unknown>();
const executeCommandMock = vi.fn<(...args: unknown[]) => unknown>();

// Held outside the mock factory (not `vi.hoisted`, since nothing here is referenced before its own
// declaration) so a test can trigger the exact `CancellationToken` callback `open-project.ts`
// subscribed with `onCancellationRequested`, from inside a fake `FileSystemReader` call — the same
// path `window.withProgress`'s real cancel button would take.
const cancelListeners: (() => void)[] = [];
function triggerCancel(): void {
  for (const listener of cancelListeners) listener();
}

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
    executeCommand: executeCommandMock,
  },
  window: {
    withProgress: (
      _options: unknown,
      task: (progress: unknown, token: unknown) => Promise<unknown>,
    ) => {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: (listener: () => void) => {
          cancelListeners.push(listener);
          return {
            dispose: () => {
              // no-op fake disposable
            },
          };
        },
      };
      return task({ report: () => null }, token);
    },
    showQuickPick: showQuickPickMock,
    showInformationMessage: showInformationMessageMock,
  },
  ProgressLocation: { Notification: 15 },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { registerOpenProjectCommand, OPEN_PROJECT_COMMAND, ProjectListCache } =
  await import('./open-project.js');
const { RUN_PRIMARY_ACTION_COMMAND } = await import('./run-primary-action.js');

interface QuickPickItemLike {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly node: unknown;
}

function unusedReader(): FileSystemReader {
  return {
    readDirectory: () => Promise.reject(new Error('not used by this test')),
    readFile: () => Promise.reject(new Error('not used by this test')),
    identity: () => Promise.reject(new Error('not used by this test')),
    realPath: () => Promise.reject(new Error('not used by this test')),
  };
}

/**
 * A root with one project-classified child (`proj-alpha`, matched by `PROJECT_NAME_RULE` below and
 * given `stopDescend: true` so its own directory is never read) and one plain, non-project child
 * (`other`) whose empty directory is read once to expand its (empty) children.
 */
function fakeProjectFs(): FileSystemReader {
  const dirs: Record<string, readonly DirEntry[]> = {
    '/work': [
      { name: 'proj-alpha', type: 'dir' },
      { name: 'other', type: 'dir' },
    ],
    '/work/other': [],
  };
  return {
    ...unusedReader(),
    readDirectory: (path: string) => Promise.resolve(dirs[path] ?? []),
  };
}

const PROJECT_NAME_RULE = {
  id: 'r1',
  when: { kind: 'nameMatches' as const, pattern: '^proj' },
  verdict: { project: true, stopDescend: true },
};

const ONE_ROOT: readonly ConfiguredRoot[] = [{ id: '/work', path: '/work' }];

/**
 * A directory chain one level deep per path segment (`/work`, `/work/lvl1`, `/work/lvl1/lvl2`, …)
 * up to `maxLevel`, every read recorded in `calls`. `cancelAfterCall` fires `triggerCancel()`
 * (this file's fake `CancellationToken`) the moment the call count it names is reached, from
 * *inside* the fake reader — mirroring the point in a real walk where the platform's cancel button
 * fires mid-traversal, not before the walk starts and not after it finishes.
 */
function fakeChainFs(maxLevel: number, calls: string[], cancelAfterCall: number): FileSystemReader {
  return {
    ...unusedReader(),
    readDirectory: (path: string) => {
      calls.push(path);
      if (calls.length === cancelAfterCall) triggerCancel();
      const level = path.split('lvl').length - 1;
      if (level >= maxLevel) return Promise.resolve([]);
      return Promise.resolve([{ name: `lvl${String(level + 1)}`, type: 'dir' as const }]);
    },
  };
}

beforeEach(() => {
  registeredHandlers.clear();
  showInformationMessageMock.mockClear();
  showQuickPickMock.mockClear();
  executeCommandMock.mockClear();
  cancelListeners.length = 0;
});

describe('registerOpenProjectCommand — finding and opening a project', () => {
  it('offers every discovered project in the QuickPick, matched by partial name', async () => {
    const cache = new ProjectListCache();
    registerOpenProjectCommand(
      cache,
      () => ONE_ROOT,
      () => [PROJECT_NAME_RULE],
      () => 4,
      fakeProjectFs(),
    );
    showQuickPickMock.mockImplementation((...args: unknown[]) => {
      const items = args[0] as QuickPickItemLike[];
      return Promise.resolve(items.find((item) => item.label === 'proj-alpha'));
    });

    await registeredHandlers.get(OPEN_PROJECT_COMMAND)?.();

    const offered = showQuickPickMock.mock.calls[0]?.[0] as QuickPickItemLike[];
    expect(offered.map((item) => item.label)).toEqual(['proj-alpha']);
    // Two independent fields distinguish same-named projects in different roots (api-facts.md,
    // fact 82): a root label/id in `description`, the full path in `detail`.
    expect(offered[0]?.description).toBe('/work');
    expect(offered[0]?.detail).toBe('/work/proj-alpha');
    expect(executeCommandMock).toHaveBeenCalledTimes(1);
    const [commandId, node] = executeCommandMock.mock.calls[0] as [
      string,
      { facts: { name: string } },
    ];
    expect(commandId).toBe(RUN_PRIMARY_ACTION_COMMAND);
    expect(node.facts.name).toBe('proj-alpha');
  });

  it('does nothing when the QuickPick is dismissed', async () => {
    const cache = new ProjectListCache();
    registerOpenProjectCommand(
      cache,
      () => ONE_ROOT,
      () => [PROJECT_NAME_RULE],
      () => 4,
      fakeProjectFs(),
    );
    showQuickPickMock.mockResolvedValue(undefined);

    await registeredHandlers.get(OPEN_PROJECT_COMMAND)?.();

    expect(executeCommandMock).not.toHaveBeenCalled();
  });

  it('reports rather than walks when no roots are configured', async () => {
    const cache = new ProjectListCache();
    registerOpenProjectCommand(
      cache,
      () => [],
      () => [],
      () => 4,
      unusedReader(),
    );

    await registeredHandlers.get(OPEN_PROJECT_COMMAND)?.();

    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
    expect(showQuickPickMock).not.toHaveBeenCalled();
  });

  it('reports rather than opens an empty QuickPick when no project is found', async () => {
    const cache = new ProjectListCache();
    registerOpenProjectCommand(
      cache,
      () => ONE_ROOT,
      () => [], // no rule ever classifies a node as a project
      () => 4,
      fakeProjectFs(),
    );

    await registeredHandlers.get(OPEN_PROJECT_COMMAND)?.();

    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
    expect(showQuickPickMock).not.toHaveBeenCalled();
  });
});

describe('registerOpenProjectCommand — cancelling the collection walk', () => {
  /**
   * Regression for a cancellation that merely rejects the promise without actually stopping the
   * walk: counts `FileSystemReader.readDirectory` invocations, not just the outcome, so a proscribed
   * fix that swallows `CancellationError` after letting the walk run to completion would still fail
   * this test — the walk must stop, not merely go unreported.
   */
  it('stops reading the filesystem once the token is cancelled mid-walk', async () => {
    const calls: string[] = [];
    const cache = new ProjectListCache();
    registerOpenProjectCommand(
      cache,
      () => ONE_ROOT,
      () => [],
      () => 20,
      fakeChainFs(20, calls, 3),
    );

    await registeredHandlers.get(OPEN_PROJECT_COMMAND)?.();

    expect(calls).toHaveLength(3);
    expect(showQuickPickMock).not.toHaveBeenCalled();
  });
});

describe('ProjectListCache', () => {
  it('serves the second get() from cache without calling build again', async () => {
    const cache = new ProjectListCache();
    const build = vi.fn(() => Promise.resolve([]));

    await cache.get(build);
    await cache.get(build);

    expect(build).toHaveBeenCalledTimes(1);
  });

  /**
   * The mechanism `extension.ts` relies on for "rules/roots/maxDepth change resets the list"
   * (04-actions.md, package 04-D): `extension.ts` itself calls `invalidate()`, not tested here since
   * the composition root has no unit test in this codebase (same convention `NodeRegistry`/
   * `RootGroupRegistry` follow — their own `invalidate()` is unit-tested here, not the call site).
   */
  it('invalidate() forces the next get() to rebuild', async () => {
    const cache = new ProjectListCache();
    const build = vi.fn<() => Promise<readonly ClassifiedNode[]>>(() => Promise.resolve([]));

    await cache.get(build);
    cache.invalidate();
    await cache.get(build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  /**
   * R07-CACHE-RACE: `invalidate()` used to clear only `#cached`, leaving `#building` in place. A
   * walk already in flight when `invalidate()` ran would, on finishing, write its (now stale)
   * result back into the cache — and a `get()` racing the invalidation would join that same stale
   * promise instead of starting a fresh build. Both symptoms are asserted here: the superseded
   * build's result never reaches the cache, and the `get()` that follows `invalidate()` triggers a
   * genuinely new `build()` call rather than awaiting the old one.
   */
  it('discards a build superseded by invalidate() while it was still in flight', async () => {
    const cache = new ProjectListCache();
    const staleResult = [{ marker: 'stale' }] as unknown as ClassifiedNode[];
    const freshResult = [{ marker: 'fresh' }] as unknown as ClassifiedNode[];
    let resolveStaleBuild!: (value: readonly ClassifiedNode[]) => void;
    // `Promise.withResolvers` needs ES2024 (`tsconfig.base.json` targets ES2022) — extracting the
    // resolver is what this test actually needs: build #1 must stay unsettled until asserted after
    // build #2 has already won the cache.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const stalePromise = new Promise<readonly ClassifiedNode[]>((resolve) => {
      resolveStaleBuild = resolve;
    });
    const build = vi.fn<() => Promise<readonly ClassifiedNode[] | undefined>>();
    build.mockReturnValueOnce(stalePromise);

    const staleGet = cache.get(build); // build #1 starts, does not resolve yet

    cache.invalidate(); // supersedes build #1 before it finishes

    build.mockReturnValueOnce(Promise.resolve(freshResult));
    const freshGetResult = await cache.get(build); // must start build #2, not join build #1
    expect(build).toHaveBeenCalledTimes(2);
    expect(freshGetResult).toBe(freshResult);

    resolveStaleBuild(staleResult); // build #1 finally finishes, after being superseded
    await staleGet;

    // The stale result must not have overwritten the cache build #2 already populated.
    const thirdGetResult = await cache.get(build);
    expect(thirdGetResult).toBe(freshResult);
    expect(build).toHaveBeenCalledTimes(2); // served from cache, no third build
  });

  it('does not cache a cancelled (undefined) build — the next get() retries', async () => {
    const cache = new ProjectListCache();
    const build = vi
      .fn<() => Promise<readonly ClassifiedNode[] | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);

    const first = await cache.get(build);
    const second = await cache.get(build);

    expect(first).toBeUndefined();
    expect(second).toEqual([]);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
