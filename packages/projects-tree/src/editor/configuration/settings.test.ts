import { describe, expect, it, vi } from 'vitest';

interface TestState {
  values: Record<string, unknown>;
  configListener: ((event: { affectsConfiguration: (s: string) => boolean }) => void) | undefined;
}

const state = vi.hoisted((): TestState => ({
  values: {},
  configListener: undefined,
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: (_section: string) => ({
      get: (key: string) => state.values[key],
    }),
    onDidChangeConfiguration: (
      listener: (event: { affectsConfiguration: (s: string) => boolean }) => void,
    ) => {
      state.configListener = listener;
      return {
        dispose: () => {
          // no-op fake disposable
        },
      };
    },
  },
}));

const { onTreeConfigurationChanged, readRoots, readShowRootNodes } = await import('./settings.js');

describe('readRoots', () => {
  it('accepts non-empty absolute path strings and reports everything else as invalid', () => {
    state.values.roots = ['/abs/one', '/abs/two', 'relative/path', '', 42, null];

    const { roots, invalid } = readRoots();

    expect(roots).toEqual([
      { id: '/abs/one', path: '/abs/one' },
      { id: '/abs/two', path: '/abs/two' },
    ]);
    expect(invalid).toEqual(['relative/path', '', '42', 'null']);
  });

  it('accepts a { path, label? } object and carries the label through', () => {
    state.values.roots = [{ path: '/abs/one' }, { path: '/abs/two', label: 'Second' }];

    expect(readRoots().roots).toEqual([
      { id: '/abs/one', path: '/abs/one' },
      { id: '/abs/two', path: '/abs/two', label: 'Second' },
    ]);
  });

  it('rejects an object root with a relative or missing path, or a non-string/empty label', () => {
    state.values.roots = [
      { path: 'relative' },
      { label: 'no path' },
      { path: '/abs', label: 42 },
      { path: '/abs', label: '' },
    ];

    const { roots, invalid } = readRoots();
    expect(roots).toEqual([]);
    expect(invalid).toHaveLength(4);
  });

  it('treats a missing or non-array setting as no roots, not an error', () => {
    state.values.roots = undefined;
    expect(readRoots()).toEqual({ roots: [], invalid: [], duplicates: [] });
  });

  it('uses the path itself as the root id', () => {
    state.values.roots = ['/one/two'];
    expect(readRoots().roots[0]?.id).toBe('/one/two');
  });

  it(// claude-01 (review-06): the path doubles as NodeKey's rootId — two entries with the same id
  // used to become two ConfiguredRoots the tree view materialized as the same object twice
  // (buildTopLevel), breaking object-identity addressing (fact 4) and TreeItem.id uniqueness
  // (fact 27). Only the first occurrence must survive.
  'deduplicates an exact-string-repeated path, keeping only the first occurrence', () => {
    state.values.roots = ['/abs/one', '/abs/one', '/abs/two'];

    const { roots, duplicates } = readRoots();

    expect(roots).toEqual([
      { id: '/abs/one', path: '/abs/one' },
      { id: '/abs/two', path: '/abs/two' },
    ]);
    expect(duplicates).toEqual(['/abs/one']);
  });

  it('deduplicates a string entry against an earlier object entry with the same path', () => {
    state.values.roots = [{ path: '/abs/one', label: 'First' }, '/abs/one'];

    const { roots, duplicates } = readRoots();

    expect(roots).toEqual([{ id: '/abs/one', path: '/abs/one', label: 'First' }]);
    expect(duplicates).toEqual(['/abs/one']);
  });

  /**
  A path copied out of a terminal often carries the separator, and the id is what every piece of
  per-node state is keyed on — so the two spellings must be one root, not two groups showing the
  same subtree.
  */
  it('treats a trailing separator as the same root', () => {
    state.values.roots = ['/abs/one', '/abs/one/', '/abs/one///'];

    const { roots, duplicates } = readRoots();

    expect(roots).toEqual([{ id: '/abs/one', path: '/abs/one' }]);
    expect(duplicates).toEqual(['/abs/one', '/abs/one']);
  });

  it('keeps the filesystem root itself, which is nothing but a separator', () => {
    state.values.roots = ['/'];

    expect(readRoots().roots).toEqual([{ id: '/', path: '/' }]);
  });

  /**
  The limitation that remains, asserted so it is a decision rather than an oversight: only string
  equality is checked, so a symlink or a case difference on a case-insensitive filesystem still
  yields two roots. Resolving either needs a filesystem call from a synchronous settings read and
  would rewrite every existing root's id — see `normalizeRootPath`.
  */
  it('does not resolve a symlink or a case difference to one root', () => {
    state.values.roots = ['/abs/one', '/abs/One'];

    const { roots, duplicates } = readRoots();

    expect(roots).toHaveLength(2);
    expect(duplicates).toEqual([]);
  });
});

describe('readShowRootNodes', () => {
  it('passes through a recognized value', () => {
    state.values.showRootNodes = 'always';
    expect(readShowRootNodes()).toBe('always');

    state.values.showRootNodes = 'never';
    expect(readShowRootNodes()).toBe('never');
  });

  it('defaults to auto for an unset or unrecognized value', () => {
    state.values.showRootNodes = undefined;
    expect(readShowRootNodes()).toBe('auto');

    state.values.showRootNodes = 'sometimes';
    expect(readShowRootNodes()).toBe('auto');
  });
});

describe('onTreeConfigurationChanged', () => {
  it('invokes the listener when either roots or showRootNodes is affected, not otherwise', () => {
    const listener = vi.fn();
    onTreeConfigurationChanged(listener);

    state.configListener?.({ affectsConfiguration: (s) => s === 'projectsTree.roots' });
    expect(listener).toHaveBeenCalledTimes(1);

    state.configListener?.({ affectsConfiguration: (s) => s === 'projectsTree.showRootNodes' });
    expect(listener).toHaveBeenCalledTimes(2);

    state.configListener?.({ affectsConfiguration: () => false });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
