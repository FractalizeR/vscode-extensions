import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT } from '../../projects/classification/index.js';
import type { ExpansionState } from './expansion.js';
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
  // Deliberately NOT `public readonly id`: at the 1.85 compatibility floor `ThemeColor` declares
  // only its constructor (api-facts.md, fact 43, corrected in round 06 — the earlier revision
  // claimed `id` was available and production code was written against it). A mock that exposes a
  // member the platform lacks is a mock that lies about the platform, and would have hidden that
  // very defect. The id is kept under a name no one can mistake for API surface, so a test can
  // still assert which colour was constructed.
  class ThemeColor {
    readonly __constructedWithId: string;
    constructor(id: string) {
      this.__constructedWithId = id;
    }
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
const { treeElementKey } = await import('./registry.js');
const { OPEN_PROJECT_COMMAND } = await import('../commands/index.js');
const { isRootGroupNode } = await import('./root-group.js');

// The explicit `ExpansionState | undefined` return annotation, not inference, is what keeps
// `unicorn/no-useless-undefined` from rewriting this to `() => {}` — a union return type is the
// rule's own carve-out for a genuinely meaningful `undefined` (eslint-plugin-unicorn,
// `no-useless-undefined.js`, `isUndefinedOrVoidReturnType`).
const noOpinion = (): ExpansionState | undefined => undefined;

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
    const folder = toTreeItem(makeNode('folder'), noOpinion);
    expect(folder.contextValue).toBe('folder');
    expect(folder.command).toBeUndefined();
    expect(folder.iconPath).toBeUndefined();

    const projectNode = makeNode('project', {
      verdict: { ...DEFAULT_VERDICT, project: { value: true, byRule: 'repo-marker' } },
    });
    const project = toTreeItem(projectNode, noOpinion);
    expect(project.contextValue).toBe('project');
    expect(project.command?.command).toBe(OPEN_PROJECT_COMMAND);
    expect(project.command?.arguments).toEqual([projectNode]);
    expect(project.iconPath).toBeDefined();
  });

  it('collapses a node with children, leaves a leaf non-collapsible', () => {
    const leaf = toTreeItem(makeNode('leaf'), noOpinion);
    expect(leaf.collapsibleState).toBe(0); // None

    const parent = toTreeItem(makeNode('parent', { children: [makeNode('child')] }), noOpinion);
    expect(parent.collapsibleState).toBe(1); // Collapsed
  });

  it('expands a node with children when the store reports it as expanded', () => {
    const node = makeNode('parent', { children: [makeNode('child')] });
    const item = toTreeItem(node, () => 'expanded');
    expect(item.collapsibleState).toBe(2); // Expanded
  });

  it('collapses a node with children when the store reports it as collapsed, overriding its own default', () => {
    const node = makeNode('parent', { children: [makeNode('child')] });
    const item = toTreeItem(node, () => 'collapsed');
    expect(item.collapsibleState).toBe(1); // Collapsed — same as the untouched default here, but
    // taken from the store, not the fallback (see the root-group test below where this matters).
  });

  it('sets a stable id from rootId + pathFromRoot, not the label', () => {
    const node = makeNode('same-name');
    const item = toTreeItem(node, noOpinion);
    expect(item.id).toBe(treeElementKey(node));
  });

  it('leaves the label a plain string when labelHighlight is not set', () => {
    const item = toTreeItem(makeNode('plain'), noOpinion);
    expect(item.label).toBe('plain');
  });

  it('turns the label into a TreeItemLabel with highlights when labelHighlight is set', () => {
    const node = makeNode('emphasized', {
      verdict: { ...DEFAULT_VERDICT, highlight: { value: { labelHighlight: true }, byRule: 'r' } },
    });
    const item = toTreeItem(node, noOpinion);
    expect(item.label).toEqual({ label: 'emphasized', highlights: [[0, 10]] });
  });

  it('renders HighlightSpec.description as TreeItem.description', () => {
    const node = makeNode('proj', {
      verdict: {
        ...DEFAULT_VERDICT,
        highlight: { value: { description: 'special' }, byRule: 'r' },
      },
    });
    const item = toTreeItem(node, noOpinion);
    expect(item.description).toBe('special');
  });

  it('leaves TreeItem.description unset when the highlight has none', () => {
    const item = toTreeItem(makeNode('proj'), noOpinion);
    expect(item.description).toBeUndefined();
  });

  it('renders HighlightSpec.icon, tinted by color, overriding the default icon', () => {
    const node = makeNode('proj', {
      verdict: {
        ...DEFAULT_VERDICT,
        highlight: { value: { icon: 'star', color: 'projectsTree.highlight' }, byRule: 'r' },
      },
    });
    const item = toTreeItem(node, noOpinion);
    const icon = item.iconPath as { id: string; color?: { __constructedWithId: string } };
    expect(icon.id).toBe('star');
    expect(icon.color?.__constructedWithId).toBe('projectsTree.highlight');
  });
});

describe('toTreeItem for a root group node', () => {
  it('is not a project: no command, its own contextValue, expanded when non-empty', () => {
    const group = { kind: 'rootGroup' as const, rootId: 'r1', label: 'My Root', children: [] };
    expect(isRootGroupNode(group)).toBe(true);

    const empty = toTreeItem(group, noOpinion);
    expect(empty.label).toBe('My Root');
    expect(empty.contextValue).toBe('rootGroup');
    expect(empty.command).toBeUndefined();
    expect(empty.collapsibleState).toBe(0); // None

    const nonEmpty = toTreeItem({ ...group, children: [makeNode('child')] }, noOpinion);
    expect(nonEmpty.collapsibleState).toBe(2); // Expanded
  });

  /**
  Round 06 review, codex-03: a collapsed root group must carry that state into whichever view
  builds its `TreeItem` next — the store, not `item.ts`, remembers it, so this is exercised as two
  independent `toTreeItem` calls (standing in for the two views' own `getTreeItem`), both fed the
  same `expansionOf` lookup a real `ExpansionStore.stateOf` would answer identically for either.
  */
  it('carries a collapsed root group into a second, independent build of the same tree', () => {
    const group = {
      kind: 'rootGroup' as const,
      rootId: 'r1',
      label: 'My Root',
      children: [makeNode('child')],
    };
    const collapsedByUser = () => 'collapsed' as const;

    const inActivityBarView = toTreeItem(group, collapsedByUser);
    const inExplorerView = toTreeItem(group, collapsedByUser);
    expect(inActivityBarView.collapsibleState).toBe(1); // Collapsed
    expect(inExplorerView.collapsibleState).toBe(1); // Collapsed
  });

  it('still defaults a never-touched, non-empty root group to expanded', () => {
    const group = {
      kind: 'rootGroup' as const,
      rootId: 'r1',
      label: 'My Root',
      children: [makeNode('child')],
    };
    const item = toTreeItem(group, noOpinion);
    expect(item.collapsibleState).toBe(2); // Expanded
  });
});
