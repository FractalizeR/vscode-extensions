import { describe, expect, it } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { NodeRegistry, nodeKey, RootGroupRegistry, treeElementKey } from './registry.js';
import type { RootGroupNode } from './root-group.js';

function makeNode(
  rootId: string,
  pathFromRoot: string,
  overrides: Partial<ClassifiedNode> = {},
): ClassifiedNode {
  const segments = pathFromRoot.split('/');
  const name = pathFromRoot === '' ? rootId : (segments.at(-1) ?? pathFromRoot);
  return {
    facts: {
      rootId,
      absolutePath: `/roots/${rootId}/${pathFromRoot}`,
      pathFromRoot,
      name,
      depthFromRoot: pathFromRoot === '' ? 0 : pathFromRoot.split('/').length,
      entries: [],
    },
    verdict: DEFAULT_VERDICT,
    children: [],
    entriesRead: false,
    ...overrides,
  };
}

function firstChild(node: ClassifiedNode): ClassifiedNode {
  const [child] = node.children;
  if (child === undefined) throw new Error('expected at least one child');
  return child;
}

describe('NodeRegistry', () => {
  it('returns the same object identity for the same key across calls', () => {
    const registry = new NodeRegistry();
    const first = registry.canonicalize(makeNode('r1', 'a'));
    const second = registry.canonicalize(makeNode('r1', 'a', { entriesRead: true }));

    expect(second).toBe(first);
    // updated in place, not just the same reference to stale data
    expect(first.entriesRead).toBe(true);
  });

  it('distinguishes the same path under two different roots', () => {
    const registry = new NodeRegistry();
    const inRootOne = registry.canonicalize(makeNode('r1', 'shared'));
    const inRootTwo = registry.canonicalize(makeNode('r2', 'shared'));

    expect(inRootOne).not.toBe(inRootTwo);
  });

  it('canonicalizes children recursively and keeps their identity too', () => {
    const registry = new NodeRegistry();
    const childV1 = makeNode('r1', 'a/child', { entriesRead: false });
    const parentV1 = makeNode('r1', 'a', { children: [childV1] });
    const canonicalParent1 = registry.canonicalize(parentV1);
    const canonicalChild1 = firstChild(canonicalParent1);

    const childV2 = makeNode('r1', 'a/child', { entriesRead: true });
    const parentV2 = makeNode('r1', 'a', { children: [childV2] });
    const canonicalParent2 = registry.canonicalize(parentV2);
    const canonicalChild2 = firstChild(canonicalParent2);

    expect(canonicalParent2).toBe(canonicalParent1);
    expect(canonicalChild2).toBe(canonicalChild1);
    expect(canonicalChild1.entriesRead).toBe(true);
  });

  it('forgets a single key without affecting others', () => {
    const registry = new NodeRegistry();
    const a = registry.canonicalize(makeNode('r1', 'a'));
    registry.canonicalize(makeNode('r1', 'b'));

    registry.forget(nodeKey('r1', 'a'));
    const aAgain = registry.canonicalize(makeNode('r1', 'a'));

    expect(aAgain).not.toBe(a);
  });

  it('invalidate() drops every canonical object', () => {
    const registry = new NodeRegistry();
    const first = registry.canonicalize(makeNode('r1', 'a'));

    registry.invalidate();
    const second = registry.canonicalize(makeNode('r1', 'a'));

    expect(second).not.toBe(first);
  });
});

describe('nodeKey', () => {
  it('combines rootId and pathFromRoot so overlapping roots cannot collide', () => {
    expect(nodeKey('root-a', 'x/y')).toBe('root-a:x/y');
    expect(nodeKey('root-a', 'x/y')).not.toBe(nodeKey('root-b', 'x/y'));
  });
});

describe('treeElementKey', () => {
  /**
  The platform matches remembered expansion by `TreeItem.id` (api-facts.md, fact 27). If this key
  and the id `item.ts` assigns ever diverge, expansion is recorded under a name the view never
  looks up, and the feature silently does nothing.
  */
  it('keys a node by rootId and path, not path alone', () => {
    expect(treeElementKey(makeNode('/a', 'p'))).toBe('/a:p');
    expect(treeElementKey(makeNode('/b', 'p'))).not.toBe(treeElementKey(makeNode('/a', 'p')));
  });

  it('keys a root group by its rootId in a separate namespace', () => {
    const group: RootGroupNode = { kind: 'rootGroup', rootId: '/a', label: 'A', children: [] };
    expect(treeElementKey(group)).toBe('root:/a');
  });
});

describe('retainOnly', () => {
  /**
  `canonicalize` only ever adds and updates, so without this sweep the registry keeps an entry for
  every node it has ever seen — including directories deleted from disk. That is not a tidiness
  issue: `ProjectsTreeProvider` prunes expansion state against the live tree, and a registry that
  never forgets made an earlier version of that prune keep exactly the keys it was meant to drop.
  */
  it('drops canonical nodes that are no longer live, keeps the ones that are', () => {
    const registry = new NodeRegistry();
    const stays = registry.canonicalize(makeNode('/a', 'stays'));
    registry.canonicalize(makeNode('/a', 'goes'));

    registry.retainOnly(new Set([treeElementKey(stays)]));

    // Identity is the observable: a key that survived returns the same object, a dropped one does
    // not — which is what the tree view's selection and expansion state hang on (fact 4).
    expect(registry.canonicalize(makeNode('/a', 'stays'))).toBe(stays);
    expect(registry.canonicalize(makeNode('/a', 'goes'))).not.toBe(stays);
  });

  it('drops a root group whose root is gone from the live set', () => {
    const groups = new RootGroupRegistry();
    const kept = groups.canonicalize('/a', 'A', []);
    const dropped = groups.canonicalize('/b', 'B', []);

    groups.retainOnly(new Set([treeElementKey(kept)]));

    expect(groups.canonicalize('/a', 'A', [])).toBe(kept);
    expect(groups.canonicalize('/b', 'B', [])).not.toBe(dropped);
  });
});
