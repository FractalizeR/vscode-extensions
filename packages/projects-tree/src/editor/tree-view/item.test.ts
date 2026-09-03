import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';

// A minimal fake of the surface `item.ts` (and, transitively, `commands/index.ts`) touches at
// import- or call-time. Vitest resolves `vscode` to this factory instead of the real module,
// which does not exist outside a running editor (`@vscode/test-cli` covers that; out of scope for
// this slice's unit tests, see `docs/plans/projects-tree/03-tree-view.md`).
vi.mock('vscode', () => {
  class TreeItem {
    label: string;
    collapsibleState: number;
    id?: string;
    resourceUri?: unknown;
    tooltip?: string;
    contextValue?: string;
    iconPath?: unknown;
    command?: { command: string; title: string; arguments?: unknown[] };
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeIcon {
    constructor(public id: string) {}
  }
  return {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
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
const { nodeKey } = await import('./registry.js');
const { OPEN_PROJECT_COMMAND } = await import('../commands/index.js');
const { isRootGroupNode } = await import('./root-group.js');

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
    const folder = toTreeItem(makeNode('folder'));
    expect(folder.contextValue).toBe('folder');
    expect(folder.command).toBeUndefined();
    expect(folder.iconPath).toBeUndefined();

    const projectNode = makeNode('project', {
      verdict: { ...DEFAULT_VERDICT, project: { value: true, byRule: 'repo-marker' } },
    });
    const project = toTreeItem(projectNode);
    expect(project.contextValue).toBe('project');
    expect(project.command?.command).toBe(OPEN_PROJECT_COMMAND);
    expect(project.command?.arguments).toEqual([projectNode]);
    expect(project.iconPath).toBeDefined();
  });

  it('collapses a node with children, leaves a leaf non-collapsible', () => {
    const leaf = toTreeItem(makeNode('leaf'));
    expect(leaf.collapsibleState).toBe(0); // None

    const parent = toTreeItem(makeNode('parent', { children: [makeNode('child')] }));
    expect(parent.collapsibleState).toBe(1); // Collapsed
  });

  it('sets a stable id from rootId + pathFromRoot, not the label', () => {
    const node = makeNode('same-name');
    const item = toTreeItem(node);
    expect(item.id).toBe(nodeKey('r1', 'same-name'));
  });
});

describe('toTreeItem for a root group node', () => {
  it('is not a project: no command, its own contextValue, expanded when non-empty', () => {
    const group = { kind: 'rootGroup' as const, rootId: 'r1', label: 'My Root', children: [] };
    expect(isRootGroupNode(group)).toBe(true);

    const empty = toTreeItem(group);
    expect(empty.label).toBe('My Root');
    expect(empty.contextValue).toBe('rootGroup');
    expect(empty.command).toBeUndefined();
    expect(empty.collapsibleState).toBe(0); // None

    const nonEmpty = toTreeItem({ ...group, children: [makeNode('child')] });
    expect(nonEmpty.collapsibleState).toBe(2); // Expanded
  });
});
