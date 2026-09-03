import { describe, expect, it } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { sortChildren } from './sort.js';

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

describe('sortChildren', () => {
  it('orders by name, numeric-aware', () => {
    const names = ['project10', 'project2', 'alpha', 'project1'].map((name) => makeNode(name));
    const sorted = sortChildren(names).map((node) => node.facts.name);
    expect(sorted).toEqual(['alpha', 'project1', 'project2', 'project10']);
  });

  it('does not mutate the input array', () => {
    const input = [makeNode('b'), makeNode('a')];
    const originalOrder = input.map((node) => node.facts.name);
    sortChildren(input);
    expect(input.map((node) => node.facts.name)).toEqual(originalOrder);
  });
});
