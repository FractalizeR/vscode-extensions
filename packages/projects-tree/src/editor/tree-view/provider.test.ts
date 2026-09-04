/**
 * `refresh()` ordering and cancellation (round 06 review, claude-03): nothing serialises two
 * overlapping calls, so the walk that *started* first must not win just because it *finishes*
 * last, and the loser must actually stop rather than run to completion unseen.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import { CancellationError } from '../../projects/discovery/index.js';
import type { ExpansionState } from './expansion.js';
import type {
  CancellationSignal,
  ClassifiedNode,
  DiscoverResult,
  FileSystemReader,
} from '../../projects/discovery/index.js';

vi.mock('vscode', () => {
  class EventEmitter<T> {
    #listeners: ((value: T) => void)[] = [];
    event = (listener: (value: T) => void): { dispose: () => void } => {
      this.#listeners.push(listener);
      return {
        dispose: () => {
          // no-op fake disposable
        },
      };
    };
    fire(value: T): void {
      for (const listener of this.#listeners) listener(value);
    }
    dispose(): void {
      // no-op fake disposable
    }
  }
  return { EventEmitter };
});

vi.mock('../../projects/discovery/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../projects/discovery/index.js')>();
  return { ...actual, discoverProjectTree: vi.fn() };
});

const { ProjectsTreeProvider } = await import('./provider.js');
const { NodeRegistry, RootGroupRegistry } = await import('./registry.js');
const { discoverProjectTree } = await import('../../projects/discovery/index.js');

const mockDiscover = vi.mocked(discoverProjectTree);

function makeNode(name: string): ClassifiedNode {
  return {
    facts: {
      rootId: 'r1',
      absolutePath: `/roots/r1/${name}`,
      pathFromRoot: name,
      name,
      depthFromRoot: 1,
      entries: [],
    },
    verdict: DEFAULT_VERDICT,
    children: [],
    entriesRead: false,
  };
}

// Not `Promise.withResolvers()`: tsconfig.base.json targets `lib: ["ES2022"]`, which predates it
// (ES2024) — same tradeoff `sort.ts`/`top-level.ts` already carry for `Array#toSorted`.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- not typed at lib: ES2022
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// The explicit `ExpansionState | undefined` / `PromiseLike<void> | undefined` return annotations,
// not inference, are what keep `unicorn/no-useless-undefined` from rewriting these to `() => {}` —
// a union return type is the rule's own carve-out for a genuinely meaningful `undefined`
// (eslint-plugin-unicorn, `no-useless-undefined.js`, `isUndefinedOrVoidReturnType`); `() => {}`
// infers `void`, which does not satisfy either method's real return type.
function makeProvider(): InstanceType<typeof ProjectsTreeProvider> {
  return new ProjectsTreeProvider(
    () => [{ id: 'r1', path: '/roots/r1' }],
    () => 'never',
    {} as FileSystemReader,
    () => [],
    new NodeRegistry(),
    new RootGroupRegistry(),
    {
      stateOf: (): ExpansionState | undefined => undefined,
      retainOnly: (): PromiseLike<void> | undefined => undefined,
    },
  );
}

function topLevelNames(provider: InstanceType<typeof ProjectsTreeProvider>): string[] {
  return provider.getChildren().map((element) => ('facts' in element ? element.facts.name : ''));
}

describe('ProjectsTreeProvider.refresh ordering', () => {
  it('applies the later-started walk and cancels the earlier one, even if the earlier one finishes second', async () => {
    const provider = makeProvider();
    const signals: CancellationSignal[] = [];
    const slow = deferred<DiscoverResult>();

    mockDiscover.mockImplementationOnce((_roots, _rules, _fs, signal) => {
      signals.push(signal);
      return slow.promise;
    });
    mockDiscover.mockImplementationOnce((_roots, _rules, _fs, signal) => {
      signals.push(signal);
      return Promise.resolve({ nodes: [makeNode('fast')], diagnostics: [] });
    });

    const slowRefresh = provider.refresh(); // starts first, suspends on `slow.promise`
    await provider.refresh(); // starts second: cancels the first, wins the race immediately

    expect(signals).toHaveLength(2);
    expect(signals[0]?.cancelled, 'the superseded walk must be cancelled, not merely outrun').toBe(
      true,
    );
    expect(topLevelNames(provider)).toEqual(['fast']);

    // The slow walk finishes late, as if its own cancellation check had not fired in time.
    // GenerationTracker must still refuse to apply a stale result.
    slow.resolve({ nodes: [makeNode('slow')], diagnostics: [] });
    await slowRefresh;
    expect(topLevelNames(provider)).toEqual(['fast']);
  });

  it('swallows the CancellationError a superseded walk raises, instead of rejecting refresh()', async () => {
    const provider = makeProvider();

    mockDiscover.mockImplementationOnce((_roots, _rules, _fs, signal) => {
      // Mirrors what the real `discoverProjectTree` does: reject once `signal` reports cancelled,
      // the same shape `walker.ts`'s `throwIfCancelled()` produces.
      return new Promise((_resolve, reject) => {
        const poll = (): void => {
          if (signal.cancelled) reject(new CancellationError());
          else setTimeout(poll, 0);
        };
        poll();
      });
    });
    mockDiscover.mockImplementationOnce(() =>
      Promise.resolve({ nodes: [makeNode('fast')], diagnostics: [] }),
    );

    const firstRefresh = provider.refresh(); // starts, then polls its (soon cancelled) signal
    await provider.refresh(); // cancels the first, applies immediately

    await expect(firstRefresh).resolves.toBeUndefined();
    expect(topLevelNames(provider)).toEqual(['fast']);
  });
});
