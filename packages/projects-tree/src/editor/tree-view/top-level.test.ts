import { describe, expect, it } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import type { ConfiguredRoot } from '../configuration/index.js';
import { RootGroupRegistry } from './registry.js';
import { isRootGroupNode } from './root-group.js';
import { buildTopLevel } from './top-level.js';

function makeNode(rootId: string, name: string): ClassifiedNode {
  return {
    facts: {
      rootId,
      absolutePath: `/roots/${rootId}/${name}`,
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

describe('buildTopLevel', () => {
  it('auto + one root: shows the root content directly, no group node', () => {
    const roots: ConfiguredRoot[] = [{ id: 'r1', path: '/roots/r1' }];
    const nodes = [makeNode('r1', 'a'), makeNode('r1', 'b')];

    const topLevel = buildTopLevel(nodes, roots, 'auto', new RootGroupRegistry());

    expect(topLevel).toHaveLength(2);
    expect(topLevel.every((element) => !isRootGroupNode(element))).toBe(true);
  });

  it('auto + two roots: one group node per root, labeled from the setting or the basename', () => {
    const roots: ConfiguredRoot[] = [
      { id: 'r1', path: '/roots/r1', label: 'First' },
      { id: 'r2', path: '/roots/r2' },
    ];
    const nodes = [makeNode('r1', 'a'), makeNode('r2', 'b')];

    const topLevel = buildTopLevel(nodes, roots, 'auto', new RootGroupRegistry());

    expect(topLevel).toHaveLength(2);
    expect(topLevel.every((element) => isRootGroupNode(element))).toBe(true);
    const labels = topLevel.map((element) => (isRootGroupNode(element) ? element.label : ''));
    expect(labels).toEqual(['First', 'r2']);
  });

  it("'always' + one root: still produces a single group node", () => {
    const roots: ConfiguredRoot[] = [{ id: 'r1', path: '/roots/r1', label: 'Only' }];
    const nodes = [makeNode('r1', 'a')];

    const topLevel = buildTopLevel(nodes, roots, 'always', new RootGroupRegistry());

    expect(topLevel).toHaveLength(1);
    const [group] = topLevel;
    expect(group && isRootGroupNode(group) ? group.label : undefined).toBe('Only');
    expect(group && isRootGroupNode(group) ? group.children : undefined).toEqual([
      makeNode('r1', 'a'),
    ]);
  });

  it("'never' + two roots: content is mixed flat at the top level", () => {
    const roots: ConfiguredRoot[] = [
      { id: 'r1', path: '/roots/r1' },
      { id: 'r2', path: '/roots/r2' },
    ];
    const nodes = [makeNode('r1', 'b'), makeNode('r2', 'a')];

    const topLevel = buildTopLevel(nodes, roots, 'never', new RootGroupRegistry());

    expect(topLevel).toHaveLength(2);
    expect(topLevel.every((element) => !isRootGroupNode(element))).toBe(true);
    // sorted by name across roots, not grouped by rootId
    expect(topLevel.map((element) => ('facts' in element ? element.facts.name : ''))).toEqual([
      'a',
      'b',
    ]);
  });

  it('a root with no matching nodes still gets an (empty) group node when grouping', () => {
    const roots: ConfiguredRoot[] = [
      { id: 'r1', path: '/roots/r1' },
      { id: 'r2', path: '/roots/r2' },
    ];
    const nodes = [makeNode('r1', 'a')];

    const topLevel = buildTopLevel(nodes, roots, 'auto', new RootGroupRegistry());

    expect(topLevel).toHaveLength(2);
    const second = topLevel[1];
    expect(second && isRootGroupNode(second) ? second.children : undefined).toEqual([]);
  });

  it('preserves canonical group node identity across calls with the same registry', () => {
    const roots: ConfiguredRoot[] = [{ id: 'r1', path: '/roots/r1' }];
    const registry = new RootGroupRegistry();

    const first = buildTopLevel([makeNode('r1', 'a')], roots, 'always', registry);
    const second = buildTopLevel(
      [makeNode('r1', 'a'), makeNode('r1', 'b')],
      roots,
      'always',
      registry,
    );

    expect(second[0]).toBe(first[0]);
  });
});
