import { describe, expect, it } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { NodeRegistry, nodeKey } from './registry.js';

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
