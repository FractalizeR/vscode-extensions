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
    expect(readRoots()).toEqual({ roots: [], invalid: [] });
  });

  it('uses the path itself as the root id', () => {
    state.values.roots = ['/one/two'];
    expect(readRoots().roots[0]?.id).toBe('/one/two');
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
