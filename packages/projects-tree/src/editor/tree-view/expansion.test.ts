import { describe, expect, it } from 'vitest';
import { ExpansionStore, treeElementKey, type ExpansionMemento } from './expansion.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import type { RootGroupNode } from './root-group.js';

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

function node(rootId: string, pathFromRoot: string): ClassifiedNode {
  return {
    facts: { rootId, pathFromRoot, name: 'x', absolutePath: `/${rootId}/${pathFromRoot}` },
    verdict: {},
    children: [],
    entriesRead: true,
  } as unknown as ClassifiedNode;
}

describe('treeElementKey', () => {
  /**
  The platform matches remembered expansion by `TreeItem.id` (api-facts.md, fact 27). If this key
  and the id `item.ts` assigns ever diverge, expansion is recorded under a name the view never
  looks up, and the feature silently does nothing.
  */
  it('keys a node by rootId and path, not path alone', () => {
    expect(treeElementKey(node('/a', 'p'))).toBe('/a:p');
    expect(treeElementKey(node('/b', 'p'))).not.toBe(treeElementKey(node('/a', 'p')));
  });

  it('keys a root group by its rootId in a separate namespace', () => {
    const group: RootGroupNode = { kind: 'rootGroup', rootId: '/a', label: 'A', children: [] };
    expect(treeElementKey(group)).toBe('root:/a');
  });
});

describe('ExpansionStore', () => {
  it('records and reports expansion', async () => {
    const memento = fakeMemento();
    const store = new ExpansionStore(memento);
    expect(store.isExpanded('/a:p')).toBe(false);
    await store.record('/a:p', true);
    expect(store.isExpanded('/a:p')).toBe(true);
    await store.record('/a:p', false);
    expect(store.isExpanded('/a:p')).toBe(false);
  });

  it('restores what a previous session stored', () => {
    expect(new ExpansionStore(fakeMemento(['/a:p'])).isExpanded('/a:p')).toBe(true);
  });

  /**
  This value survives extension upgrades. A shape change must degrade to "nothing expanded", not
  throw during activation — an exception here takes the whole tree down.
  */
  it('treats a stored value of the wrong shape as empty', () => {
    expect(() => new ExpansionStore(fakeMemento('not-an-array'))).not.toThrow();
    expect(new ExpansionStore(fakeMemento([1, null, '/a:p'])).isExpanded('/a:p')).toBe(true);
    expect(new ExpansionStore(fakeMemento({ '/a:p': true })).isExpanded('/a:p')).toBe(false);
  });

  it('drops keys that are no longer in the tree', async () => {
    const store = new ExpansionStore(fakeMemento(['/a:gone', '/a:stays']));
    await store.retainOnly(['/a:stays']);
    expect(store.isExpanded('/a:gone')).toBe(false);
    expect(store.isExpanded('/a:stays')).toBe(true);
  });

  /**
  Persisting on a no-op prune would write on every refresh for the life of the session.
  */
  it('does not write when pruning changes nothing', () => {
    const memento = fakeMemento(['/a:stays']);
    const store = new ExpansionStore(memento);
    expect(store.retainOnly(['/a:stays'])).toBeUndefined();
    expect(memento.writes).toEqual([]);
  });
});
