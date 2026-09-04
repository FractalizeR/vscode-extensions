/**
 * Cross-checks `package.json` against the code, because everything in package 03-C is a pair of
 * declarations that must agree and cannot be type-checked into agreement: a `when` clause names a
 * context key as a string, and a view id appears once in the manifest and once in `location.ts`.
 * A rename on either side shows the user no tree at all, and no other test in the suite sees it —
 * asserting the constants against themselves would only check the file against itself.
 */
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { locationContextKeys, ROOTS_CONTEXT_KEY } from '../context-keys/names.js';
import { ACTIVITY_BAR_VIEW_ID, ALL_VIEW_IDS } from './location.js';

// `commands/index.js` pulls in every command registration module for `ALL_COMMAND_IDS` below —
// each does `import * as vscode from 'vscode'` at module scope (only *called* from inside a
// `registerXCommand` function, never at import time), which needs *some* module to resolve to
// outside a running editor. Nothing in this file invokes a command handler, so an empty stub is
// enough — this mirrors the same need `item.test.ts` documents for the same reason.
vi.mock('vscode', () => ({}));

const {
  ALL_COMMAND_IDS,
  MANAGE_HIDDEN_COMMAND,
  PROJECT_CONTEXT_MENU_COMMAND_IDS,
  ROOT_GROUP_CONTEXT_MENU_COMMAND_IDS,
} = await import('../commands/index.js');

interface ViewContribution {
  readonly id: string;
  readonly when?: string;
}

interface ColorContribution {
  readonly id: string;
  readonly description: string;
  readonly defaults: Record<string, string>;
}

interface CommandContribution {
  readonly command: string;
}

interface Manifest {
  readonly main: string;
  readonly activationEvents: readonly string[];
  readonly scripts: Record<string, string>;
  readonly contributes: {
    readonly colors: readonly ColorContribution[];
    readonly views: Record<string, readonly ViewContribution[]>;
    readonly viewsWelcome: readonly { readonly view: string; readonly when: string }[];
    readonly commands: readonly CommandContribution[];
    readonly menus: Record<string, readonly { readonly command: string; readonly when: string }[]>;
    readonly configuration: { readonly properties: Record<string, { readonly enum?: string[] }> };
  };
}

const manifestPath = nodePath.join(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  '../../../package.json',
);
const manifest = JSON.parse(nodeFs.readFileSync(manifestPath, 'utf8')) as Manifest;
const declaredViews = Object.values(manifest.contributes.views).flat();
const nlsPath = nodePath.join(nodePath.dirname(manifestPath), 'package.nls.json');
const nls = JSON.parse(nodeFs.readFileSync(nlsPath, 'utf8')) as Record<string, string>;

const byName = (a: string, b: string): number => a.localeCompare(b);

describe('package.json view contributions', () => {
  it('declares exactly the view ids the code registers on', () => {
    // toSorted() would avoid the copy-then-sort dance, but it needs lib ES2023+; tsconfig
    // targets ES2022 (sort.ts carries the same tradeoff).
    /* eslint-disable unicorn/no-array-sort */
    expect(declaredViews.map((view) => view.id).sort(byName)).toEqual(
      [...ALL_VIEW_IDS].sort(byName),
    );
    /* eslint-enable unicorn/no-array-sort */
  });

  it('gates every view on a context key the code actually sets', () => {
    const settableKeys = new Set(Object.keys(locationContextKeys('activityBar')));
    for (const view of declaredViews) {
      expect(view.when, `view ${view.id} has no when clause`).toBeDefined();
      expect(
        settableKeys,
        `view ${view.id} gated on an unknown key: ${String(view.when)}`,
      ).toContain(view.when);
    }
  });

  /**
  Each mode must reach exactly one view, or a mode shows two trees or none.
  */
  it('maps each placement mode to exactly one visible view', () => {
    for (const mode of ['activityBar', 'explorer'] as const) {
      const keys = locationContextKeys(mode);
      const visible = declaredViews.filter(
        (view) => view.when !== undefined && keys[view.when as keyof typeof keys],
      );
      expect(
        visible.map((view) => view.id),
        `mode ${mode}`,
      ).toHaveLength(1);
    }
    const none = locationContextKeys('none');
    expect(
      declaredViews.filter(
        (view) => view.when !== undefined && none[view.when as keyof typeof none],
      ),
    ).toHaveLength(0);
  });

  it('activates on every view it contributes', () => {
    for (const id of ALL_VIEW_IDS) {
      expect(manifest.activationEvents).toContain(`onView:${id}`);
    }
  });

  /**
  `viewsWelcome` and `menus` name a view id each; the plan calls out that a second view means
  duplicating both (api-facts.md, fact 5). Missing the duplicate leaves the explorer placement with
  no welcome screen and no toolbar, which looks like a broken extension rather than a missing entry.
  */
  it('duplicates viewsWelcome and view/title menus onto both views', () => {
    for (const id of ALL_VIEW_IDS) {
      expect(manifest.contributes.viewsWelcome.map((entry) => entry.view)).toContain(id);
      expect(manifest.contributes.menus['view/title']?.map((entry) => entry.when)).toContain(
        `view == ${id}`,
      );
    }
  });

  it('offers the same placement modes in the setting as the code understands', () => {
    expect(manifest.contributes.configuration.properties['projectsTree.location']?.enum).toEqual([
      'activityBar',
      'explorer',
      'none',
    ]);
  });

  /**
  The activity-bar view must live in the extension's own container, not in a built-in one.
  */
  it('puts the activity-bar view in the contributed container', () => {
    expect(manifest.contributes.views.projectsTree?.map((view) => view.id)).toEqual([
      ACTIVITY_BAR_VIEW_ID,
    ]);
  });
});

describe('package.json color contributions', () => {
  /**
  A `defaults` map missing a theme kind leaves the color undefined there, and a node highlighted
  by that id simply renders unstyled — visible only to someone running that specific theme, which
  is why the plan's DoD says to check light and dark by hand. Asserting all four here is what makes
  that manual check a formality rather than the only line of defence.
  */
  it('defines every contributed color for all four theme kinds', () => {
    expect(manifest.contributes.colors.length).toBeGreaterThan(0);
    for (const color of manifest.contributes.colors) {
      const themeKinds = Object.keys(color.defaults);
      themeKinds.sort(byName);
      expect(themeKinds, color.id).toEqual(['dark', 'highContrast', 'highContrastLight', 'light']);
    }
  });

  /**
  An unresolved `%key%` is not an error to VS Code — it renders the literal `%key%` to the user in
  the settings UI. Nothing else in the suite reads the manifest's `%…%` references, so a typo here
  would ship.
  */
  it('points every color description at an NLS key that exists', () => {
    for (const color of manifest.contributes.colors) {
      const reference = /^%(?<key>.+)%$/.exec(color.description)?.groups?.key;
      expect(reference, `${color.id} description is not an NLS reference`).toBeDefined();
      expect(Object.keys(nls), color.id).toContain(reference);
    }
  });
});

describe('activation and the integration run', () => {
  /**
  A view hidden by its `when` cannot be expanded, so `onView:<id>` never fires for it; the key that
  `when` reads is set only by this extension's own activation (api-facts.md, facts 56, 57). Without
  an activation event that does not depend on a view being visible, nothing can break that cycle.
  */
  it('activates on an event that does not depend on a view being visible', () => {
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });

  /**
  The editor loads the extension from `main`, which points into `dist/` — a gitignored build
  output. `test:integration` must therefore build it, or the suite fails on any clean checkout with
  `Cannot find module .../dist/extension.js` while passing on a developer machine that happens to
  have a stale `dist/` lying around. That asymmetry is exactly what makes it worth a test: the
  failure never appears where it is introduced.
  */
  it('builds the bundle the editor loads before running integration tests', () => {
    expect(manifest.main).toMatch(/^\.\/dist\//);
    expect(manifest.scripts['test:integration']).toContain('pnpm run build');
  });
});

describe('commands and the welcome screen', () => {
  /**
  Every `view/title` entry names a command id as a bare string, and so does every `viewsWelcome`
  link. A command that is not contributed renders as a menu item that does nothing, or a welcome
  link that silently fails — neither is a type error and neither shows up in any other test. This is
  the same class of drift that let the second view id diverge from the code.
  */
  it('only puts contributed commands in the view title menu', () => {
    const contributed = new Set(manifest.contributes.commands.map((entry) => entry.command));
    const titleMenu = manifest.contributes.menus['view/title'] ?? [];
    for (const entry of titleMenu) {
      expect(contributed, 'view/title references an uncontributed command').toContain(
        entry.command,
      );
    }
  });

  it('only links contributed commands from the welcome screen', () => {
    const contributed = new Set(manifest.contributes.commands.map((entry) => entry.command));
    const welcome = JSON.stringify(manifest.contributes.viewsWelcome);
    const linked = welcome.matchAll(/command:(projectsTree\.[A-Za-z]+)/g);
    for (const [, id] of linked) {
      expect(contributed, 'viewsWelcome links an uncontributed command').toContain(id);
    }
  });

  /**
  `projectsTree.hasRoots` is set from `context-keys/set.ts` and read only as a string inside
  `viewsWelcome`'s `when`. A rename on either side leaves the welcome screen either permanently
  visible or permanently hidden, and the tree looks broken rather than empty.
  */
  it('gates the welcome screen on the roots context key the code sets', () => {
    for (const entry of manifest.contributes.viewsWelcome) {
      expect(entry.when).toBe(`!${ROOTS_CONTEXT_KEY}`);
    }
  });
});

describe('package 04-E: hide and root management menus', () => {
  it('shows Manage Hidden in the view title menu on both views', () => {
    const titleMenu = manifest.contributes.menus['view/title'] ?? [];
    for (const id of ALL_VIEW_IDS) {
      const forThisView = titleMenu
        .filter((entry) => entry.when === `view == ${id}`)
        .map((entry) => entry.command);
      expect(forThisView, id).toContain(MANAGE_HIDDEN_COMMAND);
    }
  });

  /**
  Same duplication requirement `view/title` and the fixed project menu already have (fact 5): a
  `view/item/context` entry scoped to one view id only offers "Remove Root" in that view, which
  looks like a broken context menu on the other rather than a missing entry.
  */
  it('duplicates every fixed root-group context-menu command onto both view ids', () => {
    const itemContextMenu = manifest.contributes.menus['view/item/context'] ?? [];
    for (const id of ALL_VIEW_IDS) {
      const forThisView = itemContextMenu
        .filter((entry) => entry.when.includes(`view == ${id}`))
        .map((entry) => entry.command);
      for (const commandId of ROOT_GROUP_CONTEXT_MENU_COMMAND_IDS) {
        expect(forThisView, `${id} is missing a menu entry for ${commandId}`).toContain(commandId);
      }
    }
  });

  /**
  A root group carries no `Verdict`/`facts` (`tree-view/root-group.ts`) — "Remove Root" scoped to
  `viewItem == project`/`folder` by mistake would show up on project nodes instead of (or as well
  as) root groups, and silently do nothing useful there.
  */
  it('scopes every root-group context-menu entry to a rootGroup tree item', () => {
    const itemContextMenu = manifest.contributes.menus['view/item/context'] ?? [];
    const rootGroupCommands = new Set<string>(ROOT_GROUP_CONTEXT_MENU_COMMAND_IDS);
    for (const entry of itemContextMenu) {
      if (!rootGroupCommands.has(entry.command)) continue;
      expect(entry.when, `${entry.command} has no viewItem guard`).toContain(
        'viewItem == rootGroup',
      );
    }
  });
});

describe('package 04-C: action commands and their menus', () => {
  /**
  Bidirectional by construction: an id in the manifest but not in `ALL_COMMAND_IDS` fails the
  `toContain` on `registered`, an id registered but not contributed fails the `toContain` on
  `declared` — either direction of drift turns one command into a menu item or keybinding target
  that silently does nothing (same class of bug `manifest-contract.test.ts`'s file doc comment
  already names for view ids).
  */
  it('declares exactly the commands the code registers, and registers exactly the ones declared', () => {
    const declared = manifest.contributes.commands.map((entry) => entry.command);
    const registered = [...ALL_COMMAND_IDS];
    for (const id of registered) expect(declared, `${id} not contributed`).toContain(id);
    for (const id of declared) expect(registered, `${id} not registered`).toContain(id);
  });

  /**
  Same duplication requirement `view/title` already has (fact 5, this file's earlier describe
  block): a `view/item/context` entry scoped to one view id only shows the fixed action menu items
  in that view, not the other, which looks like a broken context menu rather than a missing one.
  Broken deliberately (see this test file's own report) by removing one view's copy — the failure
  in `PROJECT_CONTEXT_MENU_COMMAND_IDS`'s absence from the filtered list confirmed this catches it.
  */
  it('duplicates every fixed project context-menu command onto both view ids', () => {
    const itemContextMenu = manifest.contributes.menus['view/item/context'] ?? [];
    for (const id of ALL_VIEW_IDS) {
      const forThisView = itemContextMenu
        .filter((entry) => entry.when.includes(`view == ${id}`))
        .map((entry) => entry.command);
      for (const commandId of PROJECT_CONTEXT_MENU_COMMAND_IDS) {
        expect(forThisView, `${id} is missing a menu entry for ${commandId}`).toContain(commandId);
      }
    }
  });

  /**
  `PROJECT_CONTEXT_MENU_COMMAND_IDS`' entries only — `view/item/context` also carries "Remove Root"
  (package 04-E), scoped to `rootGroup` instead and checked by its own describe block below, so this
  can no longer assert the guard against every entry in the array.
  */
  it('scopes every project context-menu entry to a project (or, for Hide, a folder) tree item', () => {
    const itemContextMenu = manifest.contributes.menus['view/item/context'] ?? [];
    const projectCommands = new Set<string>(PROJECT_CONTEXT_MENU_COMMAND_IDS);
    for (const entry of itemContextMenu) {
      if (!projectCommands.has(entry.command)) continue;
      expect(entry.when, `${entry.command} has no viewItem guard`).toContain('viewItem == project');
    }
  });
});
