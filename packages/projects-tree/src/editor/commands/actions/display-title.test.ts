import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { displayTitleFor } = await import('./display-title.js');
const { BUILT_IN_ACTIONS } = await import('../../../projects/actions/index.js');

describe('displayTitleFor', () => {
  it('localizes a genuine built-in action, ignoring that it carries no title of its own', () => {
    // R07-L10N-BYPASS: builtin.ts deliberately declares no `title` (it cannot call vscode.l10n.t
    // from the vscode-free core) — the localized text must come from this adapter, keyed by
    // reference to the fixed BUILT_IN_ACTIONS objects, not from a `title` field that does not exist.
    const [openInNewWindow] = BUILT_IN_ACTIONS;
    if (openInNewWindow === undefined) throw new Error('BUILT_IN_ACTIONS is unexpectedly empty');
    expect(openInNewWindow.title).toBeUndefined();
    expect(displayTitleFor(openInNewWindow)).toBe('Open in New Window');
  });

  it('localizes every declared built-in action to a non-empty, distinct title', () => {
    const titles = BUILT_IN_ACTIONS.map((action) => displayTitleFor(action));
    expect(titles.every((title) => title.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("shows a file-declared action's own title verbatim, never translated", () => {
    // A rules-file action's title is user data — even one that happens to reuse a built-in's id
    // (registry.ts: "a file-declared action with the same id as a built-in wins") is a *different
    // object*, not one of BUILT_IN_ACTIONS by reference, so it must not be swapped for the built-in's
    // localized title.
    const [builtinOpenInNewWindow] = BUILT_IN_ACTIONS;
    if (builtinOpenInNewWindow === undefined) {
      throw new Error('BUILT_IN_ACTIONS is unexpectedly empty');
    }
    const fileAction = {
      id: 'builtin.openInNewWindow',
      title: 'Открыть тут',
      spec: builtinOpenInNewWindow.spec,
    };
    expect(displayTitleFor(fileAction)).toBe('Открыть тут');
  });

  it('falls back to the id for a file-declared action with no title', () => {
    const fileAction = {
      id: 'my.custom.action',
      spec: { kind: 'uri' as const, template: 'x://y' },
    };
    expect(displayTitleFor(fileAction)).toBe('my.custom.action');
  });
});
