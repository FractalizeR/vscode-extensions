import { describe, expect, it } from 'vitest';
import { DEFAULT_VERDICT, type Verdict } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { sortChildren } from './sort.js';

function makeNode(name: string, verdict: Verdict = DEFAULT_VERDICT): ClassifiedNode {
  return {
    facts: {
      rootId: 'r1',
      absolutePath: `/roots/r1/${name}`,
      pathFromRoot: name,
      name,
      depthFromRoot: 1,
      entries: [],
    },
    verdict,
    children: [],
    entriesRead: false,
  };
}

function withProject(): Verdict {
  return { ...DEFAULT_VERDICT, project: { value: true, byRule: undefined } };
}

function withSortWeight(weight: number): Verdict {
  return {
    ...DEFAULT_VERDICT,
    highlight: { value: { sortWeight: weight }, byRule: undefined },
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

  it('sorts by sortWeight first, higher weight before lower and before unweighted', () => {
    const low = makeNode('low', withSortWeight(1));
    const high = makeNode('high', withSortWeight(10));
    const unweighted = makeNode('unweighted');
    const sorted = sortChildren([low, unweighted, high]).map((node) => node.facts.name);
    expect(sorted).toEqual(['high', 'low', 'unweighted']);
  });

  it('breaks an equal-weight tie by folder before project, then falls back to name', () => {
    const project = makeNode('proj', withProject());
    const folder = makeNode('folder');
    const sorted = sortChildren([project, folder]).map((node) => node.facts.name);
    expect(sorted).toEqual(['folder', 'proj']);
  });

  it('falls back to numeric name ordering only after weight and folder/project agree', () => {
    const names = ['project10', 'project2', 'alpha', 'project1'].map((name) => makeNode(name));
    const sorted = sortChildren(names).map((node) => node.facts.name);
    expect(sorted).toEqual(['alpha', 'project1', 'project2', 'project10']);
  });

  it('a higher sortWeight on a project still beats a plain folder', () => {
    const boostedProject = makeNode('proj', {
      ...withProject(),
      highlight: { value: { sortWeight: 5 }, byRule: undefined },
    });
    const folder = makeNode('folder');
    const sorted = sortChildren([folder, boostedProject]).map((node) => node.facts.name);
    expect(sorted).toEqual(['proj', 'folder']);
  });
});
