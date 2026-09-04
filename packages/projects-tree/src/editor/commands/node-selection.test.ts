import { describe, expect, it } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { resolveActionNode, resolveNode, type NodeSelection } from './node-selection.js';

function node(name: string): ClassifiedNode {
  return {
    facts: {
      rootId: '/work',
      absolutePath: `/work/${name}`,
      pathFromRoot: name,
      name,
      depthFromRoot: 1,
      entries: [],
    },
    verdict: DEFAULT_VERDICT,
    children: [],
    entriesRead: true,
  };
}

describe('resolveActionNode', () => {
  it('prefers the explicit node over the selection', () => {
    const explicit = node('explicit');
    const selection: NodeSelection = {
      currentProjectNode: () => node('selected'),
      currentNode: () => node('selected'),
    };

    expect(resolveActionNode(explicit, selection)).toBe(explicit);
  });

  it('falls back to the selection when no explicit node is given', () => {
    const selected = node('selected');
    const selection: NodeSelection = {
      currentProjectNode: () => selected,
      currentNode: () => selected,
    };

    expect(resolveActionNode(undefined, selection)).toBe(selected);
  });

  it('is undefined when neither an explicit node nor a selection exists', () => {
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };

    expect(resolveActionNode(undefined, selection)).toBeUndefined();
  });
});

describe('resolveNode', () => {
  it('prefers the explicit node over the selection', () => {
    const explicit = node('explicit');
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: () => node('selected'),
    };

    expect(resolveNode(explicit, selection)).toBe(explicit);
  });

  it('falls back to currentNode (not currentProjectNode) when no explicit node is given', () => {
    const selected = node('a-plain-folder');
    const selection: NodeSelection = {
      // Regression guard: resolveNode must read currentNode, not currentProjectNode — a folder
      // that is not a project has no representation there at all.
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: () => selected,
    };

    expect(resolveNode(undefined, selection)).toBe(selected);
  });

  it('is undefined when neither an explicit node nor a selection exists', () => {
    const selection: NodeSelection = {
      currentProjectNode: (): ClassifiedNode | undefined => undefined,
      currentNode: (): ClassifiedNode | undefined => undefined,
    };

    expect(resolveNode(undefined, selection)).toBeUndefined();
  });
});
