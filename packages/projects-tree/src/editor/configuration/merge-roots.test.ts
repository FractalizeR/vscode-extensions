import { describe, expect, it } from 'vitest';
import type { ConfiguredRoot } from './settings.js';
import { mergeRoots } from './merge-roots.js';

describe('mergeRoots', () => {
  it('appends a genuinely new path', () => {
    const existing: ConfiguredRoot[] = [{ id: '/abs/one', path: '/abs/one' }];

    expect(mergeRoots(existing, ['/abs/two'])).toEqual(['/abs/one', '/abs/two']);
  });

  it('adding the same path again changes nothing', () => {
    const existing: ConfiguredRoot[] = [{ id: '/abs/one', path: '/abs/one' }];

    expect(mergeRoots(existing, ['/abs/one'])).toEqual(['/abs/one']);
  });

  it('adding a new path next to a labeled root keeps the label', () => {
    const existing: ConfiguredRoot[] = [{ id: '/abs/one', path: '/abs/one', label: 'Work' }];

    expect(mergeRoots(existing, ['/abs/two'])).toEqual([
      { path: '/abs/one', label: 'Work' },
      '/abs/two',
    ]);
  });

  it('re-adding a path that already carries a label leaves it untouched, still labeled', () => {
    const existing: ConfiguredRoot[] = [{ id: '/abs/one', path: '/abs/one', label: 'Work' }];

    expect(mergeRoots(existing, ['/abs/one'])).toEqual([{ path: '/abs/one', label: 'Work' }]);
  });

  it('deduplicates within newPaths itself, not only against existing', () => {
    expect(mergeRoots([], ['/abs/one', '/abs/one'])).toEqual(['/abs/one']);
  });

  it('an empty existing list with new paths just lists them', () => {
    expect(mergeRoots([], ['/abs/one', '/abs/two'])).toEqual(['/abs/one', '/abs/two']);
  });
});
