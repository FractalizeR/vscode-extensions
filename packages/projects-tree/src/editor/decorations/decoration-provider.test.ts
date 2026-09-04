import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT, type Verdict } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import type { RootGroupNode, TreeElement } from '../tree-view/root-group.js';

// Minimal fake of the surface this module touches — same approach as `tree-view/item.test.ts`.
// `FileDecoration.validate` (api-facts.md, fact 7) is not reproduced here: this module's own guard
// (`isBadgeWithinPlatformLimit`) is what is under test, not the platform's.
vi.mock('vscode', () => {
  // No public `id`: at the 1.85 floor `ThemeColor` declares only its constructor (api-facts.md,
  // fact 43). Nothing here asserts on the colour's id — the tests check the plain `colorId` on the
  // spec before a `ThemeColor` is ever built — so the mock has no reason to expose more than the
  // platform does. See item.test.ts for the same reasoning at length.
  class ThemeColor {
    constructor(readonly _id: string) {}
  }
  class FileDecoration {
    propagate?: boolean;
    constructor(
      public badge?: string,
      public tooltip?: string,
      public color?: ThemeColor,
    ) {}
  }
  class EventEmitter<T> {
    #listeners: ((value: T) => void)[] = [];
    event = (listener: (value: T) => void) => {
      this.#listeners.push(listener);
      return {
        dispose: () => {
          // no-op fake disposable
        },
      };
    };
    fire(value: T): void {
      for (const listener of this.#listeners) listener(value);
    }
    dispose(): void {
      this.#listeners = [];
    }
  }
  const Uri = {
    file: (path: string) => ({
      fsPath: path,
      toString: () => `file://${path}`,
    }),
  };
  return { ThemeColor, FileDecoration, EventEmitter, Uri };
});

const { buildDecorationSpec, isBadgeWithinPlatformLimit, HighlightDecorationProvider } =
  await import('./decoration-provider.js');

function makeUri(path: string): { fsPath: string; toString: () => string } {
  return { fsPath: path, toString: () => `file://${path}` };
}

function makeNode(
  name: string,
  overrides: Partial<{ verdict: Verdict; children: ClassifiedNode[] }> = {},
  parentPath = '/roots/r1',
): ClassifiedNode {
  return {
    facts: {
      rootId: 'r1',
      absolutePath: `${parentPath}/${name}`,
      pathFromRoot: name,
      name,
      depthFromRoot: 1,
      entries: [],
    },
    verdict: overrides.verdict ?? DEFAULT_VERDICT,
    children: overrides.children ?? [],
    entriesRead: false,
  };
}

function withHighlight(highlight: NonNullable<Verdict['highlight']['value']>): Verdict {
  return { ...DEFAULT_VERDICT, highlight: { value: highlight, byRule: 'r' } };
}

describe('buildDecorationSpec', () => {
  it('produces no spec for a HighlightSpec with only sortWeight', () => {
    expect(buildDecorationSpec({ sortWeight: 5 })).toBeUndefined();
  });

  it('produces no spec for an undefined HighlightSpec', () => {
    expect(buildDecorationSpec(undefined)).toBeUndefined();
  });

  it('produces no spec for a HighlightSpec with only icon/description/labelHighlight', () => {
    expect(
      buildDecorationSpec({ icon: 'star', description: 'x', labelHighlight: true }),
    ).toBeUndefined();
  });

  it('carries badge, tooltip and colorId, by value, when badge is set', () => {
    const spec = buildDecorationSpec({
      badge: 'AB',
      color: 'projectsTree.highlight',
      description: 'A highlighted project',
    });
    expect(spec).toEqual({
      badge: 'AB',
      tooltip: 'A highlighted project',
      colorId: 'projectsTree.highlight',
    });
  });

  it('carries colorId alone when only color is set', () => {
    const spec = buildDecorationSpec({ color: 'projectsTree.highlight' });
    expect(spec).toEqual({
      badge: undefined,
      tooltip: undefined,
      colorId: 'projectsTree.highlight',
    });
  });

  it('drops an over-limit badge but keeps colorId, rather than producing no spec at all', () => {
    const spec = buildDecorationSpec({ badge: 'ABC', color: 'projectsTree.highlight' });
    expect(spec).toEqual({
      badge: undefined,
      tooltip: undefined,
      colorId: 'projectsTree.highlight',
    });
  });

  it('an over-limit badge with no color produces no spec at all', () => {
    expect(buildDecorationSpec({ badge: 'ABC' })).toBeUndefined();
  });

  it(// codex-05 (review-06): '' is falsy, so VS Code's own `!d.badge` emptiness check does not
  // catch it when `color` is also set — this module's own guard must, or the badge slot renders
  // with nothing visible while the rest of the decoration is accepted whole.
  'drops an empty badge but keeps colorId, rather than passing an invisible badge through', () => {
    const spec = buildDecorationSpec({ badge: '', color: 'projectsTree.highlight' });
    expect(spec).toEqual({
      badge: undefined,
      tooltip: undefined,
      colorId: 'projectsTree.highlight',
    });
  });

  it('an empty badge with no color produces no spec at all', () => {
    expect(buildDecorationSpec({ badge: '' })).toBeUndefined();
  });

  it('drops a whitespace-only badge the same way as an empty one', () => {
    const spec = buildDecorationSpec({ badge: ' '.repeat(3), color: 'projectsTree.highlight' });
    expect(spec?.badge).toBeUndefined();
  });

  it('keeps a one-character badge', () => {
    expect(buildDecorationSpec({ badge: '!' })?.badge).toBe('!');
  });
});

describe('isBadgeWithinPlatformLimit — counted in Unicode code points, not UTF-16 units', () => {
  it('accepts two ASCII characters and rejects three', () => {
    expect(isBadgeWithinPlatformLimit('AB')).toBe(true);
    expect(isBadgeWithinPlatformLimit('ABC')).toBe(false);
  });

  it('accepts two surrogate-pair emoji (4 UTF-16 units, 2 code points)', () => {
    expect('🔥🔥'.length).toBe(4); // UTF-16 units — .length would wrongly reject this as "4"
    expect(isBadgeWithinPlatformLimit('🔥🔥')).toBe(true);
  });

  it('rejects three surrogate-pair emoji (3 code points)', () => {
    expect(isBadgeWithinPlatformLimit('🔥🔥🔥')).toBe(false);
  });
});

describe('HighlightDecorationProvider', () => {
  it('provideFileDecoration returns undefined for an undecorated node', () => {
    const provider = new HighlightDecorationProvider();
    const node = makeNode('plain');
    provider.update([node]);
    expect(
      provider.provideFileDecoration(makeUri(node.facts.absolutePath) as never),
    ).toBeUndefined();
  });

  it('provideFileDecoration returns a decoration carrying badge, tooltip and colour', () => {
    const provider = new HighlightDecorationProvider();
    const node = makeNode('proj', {
      verdict: withHighlight({ badge: 'X', color: 'c', description: 'tip' }),
    });
    provider.update([node]);
    const decoration = provider.provideFileDecoration(makeUri(node.facts.absolutePath) as never);
    expect(decoration?.badge).toBe('X');
    expect(decoration?.tooltip).toBe('tip');
    expect(decoration?.color).toBeDefined();
    // Not propagated: this provider is global, so a highlight climbing to its ancestors would
    // badge unrelated folders in the Explorer. Deliberate, and recorded in 03-tree-view.md — a
    // per-rule field is stage 04's subject.
    expect(decoration?.propagate).toBeUndefined();
  });

  it('an over-limit badge never reaches the decoration returned by provideFileDecoration', () => {
    const provider = new HighlightDecorationProvider();
    const node = makeNode('proj', { verdict: withHighlight({ badge: 'ABC', color: 'c' }) });
    provider.update([node]);
    const decoration = provider.provideFileDecoration(makeUri(node.facts.absolutePath) as never);
    expect(decoration?.badge).toBeUndefined();
    expect(decoration?.color).toBeDefined();
  });

  it('a badge-only spec that is over-limit produces no decoration at all', () => {
    const provider = new HighlightDecorationProvider();
    const node = makeNode('proj', { verdict: withHighlight({ badge: 'ABC' }) });
    provider.update([node]);
    expect(
      provider.provideFileDecoration(makeUri(node.facts.absolutePath) as never),
    ).toBeUndefined();
  });

  /**
  Only the node whose own decoration changed is signalled. Ancestors are not, because nothing
  propagates to them — signalling a URI whose decoration cannot have changed is work with no
  observable effect. This assertion is what makes the pairing explicit: were `propagate` turned
  back on without restoring the ancestor signal, fact 9 says the ancestor would never re-ask and
  the propagated badge would silently not appear.
  */
  it('signals the changed node only, not its ancestors', () => {
    const provider = new HighlightDecorationProvider();
    const child = makeNode('child', {}, '/roots/r1/parent');
    const parent = makeNode('parent', { children: [child] });
    provider.update([parent]);

    const fired: unknown[] = [];
    provider.onDidChangeFileDecorations((uris) => {
      fired.push(uris);
    });

    const decoratedChild = makeNode(
      'child',
      { verdict: withHighlight({ badge: 'X' }) },
      '/roots/r1/parent',
    );
    const sameParent = makeNode('parent', { children: [decoratedChild] });
    provider.update([sameParent]);

    expect(fired).toHaveLength(1);
    const signalled = (fired[0] as { toString: () => string }[]).map((u) => u.toString());
    expect(signalled).toEqual([`file://${decoratedChild.facts.absolutePath}`]);
  });

  it('does not signal anything when update() is called with an unchanged tree', () => {
    const provider = new HighlightDecorationProvider();
    const node = makeNode('proj', { verdict: withHighlight({ badge: 'X' }) });
    provider.update([node]);

    const fired: unknown[] = [];
    provider.onDidChangeFileDecorations((uris) => {
      fired.push(uris);
    });
    provider.update([makeNode('proj', { verdict: withHighlight({ badge: 'X' }) })]);

    expect(fired).toHaveLength(0);
  });

  it('a RootGroupNode in the tree does not throw and gets no decoration of its own', () => {
    const provider = new HighlightDecorationProvider();
    const child = makeNode('proj', { verdict: withHighlight({ badge: 'X' }) });
    const group: RootGroupNode = {
      kind: 'rootGroup',
      rootId: 'r1',
      label: 'Root',
      children: [child],
    };
    const elements: readonly TreeElement[] = [group];

    expect(() => {
      provider.update(elements);
    }).not.toThrow();
    // The group itself has no resourceUri/decoration entry — only its child does.
    expect(provider.provideFileDecoration(makeUri(child.facts.absolutePath) as never)?.badge).toBe(
      'X',
    );
  });

  it(// codex-09/claude-05 (review-06): two overlapping roots can classify the same absolute path
  // differently, but `provideFileDecoration` receives only a `Uri` — no way to say which node's
  // decoration is wanted. Decision: first root in walk order wins, deterministically, rather than
  // the two decorations silently colliding into whichever `update()` happened to process last.
  'first-root-wins when two overlapping roots classify the same absolute path differently', () => {
    const provider = new HighlightDecorationProvider();
    const first = makeNode('shared', { verdict: withHighlight({ badge: '1' }) }, '/roots/r1');
    const second: ClassifiedNode = {
      ...makeNode('shared', { verdict: withHighlight({ badge: '2' }) }, '/roots/r1'),
      facts: { ...first.facts, rootId: 'r2' },
    };
    provider.update([first, second]);

    const decoration = provider.provideFileDecoration(makeUri(first.facts.absolutePath) as never);
    expect(decoration?.badge).toBe('1');
  });
});
