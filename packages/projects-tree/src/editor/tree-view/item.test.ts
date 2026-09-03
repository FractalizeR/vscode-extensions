import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';

// A minimal fake of the surface `item.ts` (and, transitively, `commands/index.ts`) touches at
// import- or call-time. Vitest resolves `vscode` to this factory instead of the real module,
// which does not exist outside a running editor (`@vscode/test-cli` covers that; out of scope for
// this slice's unit tests, see `docs/plans/projects-tree/03-tree-view.md`).
vi.mock('vscode', () => {
  class TreeItem {
    label: string | { label: string; highlights?: [number, number][] };
    collapsibleState: number;
    id?: string;
    resourceUri?: unknown;
    tooltip?: string;
    description?: string | boolean;
    contextValue?: string;
    iconPath?: unknown;
    command?: { command: string; title: string; arguments?: unknown[] };
    constructor(
      label: string | { label: string; highlights?: [number, number][] },
      collapsibleState: number,
    ) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeColor {
    constructor(public readonly id: string) {}
  }
  class ThemeIcon {
    constructor(
      public id: string,
      public color?: ThemeColor,
    ) {}
  }
  return {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeColor,
    ThemeIcon,
    Uri: { file: (path: string) => ({ fsPath: path }) },
    l10n: { t: (message: string) => message },
    commands: {
      registerCommand: () => ({
        dispose: () => {
          // no-op fake disposable
        },
      }),
      executeCommand: vi.fn(),
    },
  };
});

const { toTreeItem } = await import('./item.js');
const { treeElementKey } = await import('./expansion.js');
const { OPEN_PROJECT_COMMAND } = await import('../commands/index.js');
const { isRootGroupNode } = await import('./root-group.js');

const isNeverExpanded = () => false;

function makeNode(name: string, overrides: Partial<ClassifiedNode> = {}): ClassifiedNode {
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
    ...overrides,
  };
}

describe('toTreeItem', () => {
  it('marks a project node with a command and an icon, a folder node with neither', () => {
    const folder = toTreeItem(makeNode('folder'), isNeverExpanded);
    expect(folder.contextValue).toBe('folder');
    expect(folder.command).toBeUndefined();
    expect(folder.iconPath).toBeUndefined();

    const projectNode = makeNode('project', {
      verdict: { ...DEFAULT_VERDICT, project: { value: true, byRule: 'repo-marker' } },
    });
    const project = toTreeItem(projectNode, isNeverExpanded);
    expect(project.contextValue).toBe('project');
    expect(project.command?.command).toBe(OPEN_PROJECT_COMMAND);
    expect(project.command?.arguments).toEqual([projectNode]);
    expect(project.iconPath).toBeDefined();
  });

  it('collapses a node with children, leaves a leaf non-collapsible', () => {
    const leaf = toTreeItem(makeNode('leaf'), isNeverExpanded);
    expect(leaf.collapsibleState).toBe(0); // None

    const parent = toTreeItem(
      makeNode('parent', { children: [makeNode('child')] }),
      isNeverExpanded,
    );
    expect(parent.collapsibleState).toBe(1); // Collapsed
  });

  it('expands a node with children when the store reports it as expanded', () => {
    const node = makeNode('parent', { children: [makeNode('child')] });
    const item = toTreeItem(node, () => true);
    expect(item.collapsibleState).toBe(2); // Expanded
  });

  it('sets a stable id from rootId + pathFromRoot, not the label', () => {
    const node = makeNode('same-name');
    const item = toTreeItem(node, isNeverExpanded);
    expect(item.id).toBe(treeElementKey(node));
  });

  it('leaves the label a plain string when labelHighlight is not set', () => {
    const item = toTreeItem(makeNode('plain'), isNeverExpanded);
    expect(item.label).toBe('plain');
  });

  it('turns the label into a TreeItemLabel with highlights when labelHighlight is set', () => {
    const node = makeNode('emphasized', {
      verdict: { ...DEFAULT_VERDICT, highlight: { value: { labelHighlight: true }, byRule: 'r' } },
    });
    const item = toTreeItem(node, isNeverExpanded);
    expect(item.label).toEqual({ label: 'emphasized', highlights: [[0, 10]] });
  });

  it('renders HighlightSpec.description as TreeItem.description', () => {
    const node = makeNode('proj', {
      verdict: {
        ...DEFAULT_VERDICT,
        highlight: { value: { description: 'special' }, byRule: 'r' },
      },
    });
    const item = toTreeItem(node, isNeverExpanded);
    expect(item.description).toBe('special');
  });

  it('leaves TreeItem.description unset when the highlight has none', () => {
    const item = toTreeItem(makeNode('proj'), isNeverExpanded);
    expect(item.description).toBeUndefined();
  });

  it('renders HighlightSpec.icon, tinted by color, overriding the default icon', () => {
    const node = makeNode('proj', {
      verdict: {
        ...DEFAULT_VERDICT,
        highlight: { value: { icon: 'star', color: 'projectsTree.highlight' }, byRule: 'r' },
      },
    });
    const item = toTreeItem(node, isNeverExpanded);
    const icon = item.iconPath as { id: string; color?: { id: string } };
    expect(icon.id).toBe('star');
    expect(icon.color?.id).toBe('projectsTree.highlight');
  });
});

describe('toTreeItem for a root group node', () => {
  it('is not a project: no command, its own contextValue, expanded when non-empty', () => {
    const group = { kind: 'rootGroup' as const, rootId: 'r1', label: 'My Root', children: [] };
    expect(isRootGroupNode(group)).toBe(true);

    const empty = toTreeItem(group, isNeverExpanded);
    expect(empty.label).toBe('My Root');
    expect(empty.contextValue).toBe('rootGroup');
    expect(empty.command).toBeUndefined();
    expect(empty.collapsibleState).toBe(0); // None

    const nonEmpty = toTreeItem({ ...group, children: [makeNode('child')] }, isNeverExpanded);
    expect(nonEmpty.collapsibleState).toBe(2); // Expanded
  });
});
