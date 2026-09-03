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
import { describe, expect, it } from 'vitest';
import { ACTIVITY_BAR_VIEW_ID, ALL_VIEW_IDS, locationContextKeys } from './location.js';

interface ViewContribution {
  readonly id: string;
  readonly when?: string;
}

interface ColorContribution {
  readonly id: string;
  readonly description: string;
  readonly defaults: Record<string, string>;
}

interface Manifest {
  readonly activationEvents: readonly string[];
  readonly contributes: {
    readonly colors: readonly ColorContribution[];
    readonly views: Record<string, readonly ViewContribution[]>;
    readonly viewsWelcome: readonly { readonly view: string }[];
    readonly menus: Record<string, readonly { readonly when: string }[]>;
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
