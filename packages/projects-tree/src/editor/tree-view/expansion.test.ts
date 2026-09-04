import { describe, expect, it } from 'vitest';
import { ExpansionStore, type ExpansionMemento } from './expansion.js';

function fakeMemento(initial?: unknown): ExpansionMemento & { readonly writes: unknown[] } {
  const store = new Map<string, unknown>();
  if (initial !== undefined) store.set('projectsTree.expandedNodes', initial);
  const writes: unknown[] = [];
  return {
    writes,
    get: (key: string): unknown => store.get(key),
    update: (key: string, value: unknown) => {
      store.set(key, value);
      writes.push(value);
      return Promise.resolve();
    },
  };
}

describe('ExpansionStore', () => {
  it('records and reports expansion and collapse, distinct from never having been touched', async () => {
    const memento = fakeMemento();
    const store = new ExpansionStore(memento);
    expect(store.stateOf('/a:p')).toBeUndefined();
    await store.record('/a:p', true);
    expect(store.stateOf('/a:p')).toBe('expanded');
    await store.record('/a:p', false);
    expect(store.stateOf('/a:p')).toBe('collapsed');
  });

  it('restores what a previous session stored, in the current shape', () => {
    const memento = fakeMemento({ expanded: ['/a:p'], collapsed: ['/a:q'] });
    const store = new ExpansionStore(memento);
    expect(store.stateOf('/a:p')).toBe('expanded');
    expect(store.stateOf('/a:q')).toBe('collapsed');
    expect(store.stateOf('/a:r')).toBeUndefined();
  });

  /**
  The store's original shape was a plain array of expanded keys — no collapsed state existed to
  record. An installation upgrading from that shape must not lose what it *could* express: every
  listed key is still read back as explicitly expanded.
  */
  it('honours the previous shape — a plain array of expanded keys', () => {
    const store = new ExpansionStore(fakeMemento(['/a:p', '/a:q']));
    expect(store.stateOf('/a:p')).toBe('expanded');
    expect(store.stateOf('/a:q')).toBe('expanded');
    expect(store.stateOf('/a:untouched')).toBeUndefined();
  });

  /**
  This value survives extension upgrades. A shape change must degrade to "nothing recorded", not
  throw during activation — an exception here takes the whole tree down.
  */
  it('treats a stored value of an unrecognized shape as empty', () => {
    expect(() => new ExpansionStore(fakeMemento('not-an-array'))).not.toThrow();
    expect(new ExpansionStore(fakeMemento([1, null, '/a:p'])).stateOf('/a:p')).toBe('expanded');
    expect(new ExpansionStore(fakeMemento({ '/a:p': true })).stateOf('/a:p')).toBeUndefined();
  });

  it('persists both expanded and collapsed keys in the current shape', async () => {
    const memento = fakeMemento();
    const store = new ExpansionStore(memento);
    await store.record('/a:p', true);
    await store.record('/a:q', false);
    expect(memento.writes.at(-1)).toEqual({ expanded: ['/a:p'], collapsed: ['/a:q'] });
  });

  it('drops keys that are no longer in the tree, regardless of their state', async () => {
    const store = new ExpansionStore(
      fakeMemento({ expanded: ['/a:gone', '/a:stays'], collapsed: ['/a:also-gone'] }),
    );
    await store.retainOnly(['/a:stays']);
    expect(store.stateOf('/a:gone')).toBeUndefined();
    expect(store.stateOf('/a:also-gone')).toBeUndefined();
    expect(store.stateOf('/a:stays')).toBe('expanded');
  });

  /**
  Persisting on a no-op prune would write on every refresh for the life of the session.
  */
  it('does not write when pruning changes nothing', () => {
    const memento = fakeMemento({ expanded: ['/a:stays'], collapsed: [] });
    const store = new ExpansionStore(memento);
    expect(store.retainOnly(['/a:stays'])).toBeUndefined();
    expect(memento.writes).toEqual([]);
  });
});
