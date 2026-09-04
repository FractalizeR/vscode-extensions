import type { ActionDefinition } from './action';

/**
 * The three `openFolder` actions every install ships with, regardless of the rules file. Plain
 * data — no `vscode` import (see `action.ts`'s doc comment on why this subject cannot depend on the
 * editor). `docs/plans/projects-tree/04-actions.md`, package 04-A.
 *
 * Deliberately no `title`: this package cannot import `vscode`, so it cannot call `vscode.l10n.t()`
 * — a hardcoded English `title` here would show up in every UI surface untranslated and invisible
 * to `l10n:check` (R07-L10N-BYPASS). The adapter (`editor/commands/show-actions.ts`) recognizes
 * these specific objects, by reference, and supplies a localized display title at the point of
 * display instead. `id` stays the stable, locale-neutral identity `primaryAction`/keybindings
 * reference; a `title` field remains on `ActionDefinition` for actions a *rules file* declares,
 * where it is the file author's own text and must be shown verbatim, never translated.
 */
export const BUILT_IN_ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'builtin.openInNewWindow',
    spec: { kind: 'openFolder', window: 'new' },
  },
  {
    id: 'builtin.openInCurrentWindow',
    spec: { kind: 'openFolder', window: 'current' },
  },
  {
    id: 'builtin.openAuto',
    spec: { kind: 'openFolder', window: 'auto' },
  },
] as const;

/**
 * Default value of the `projectsTree.defaultAction` setting (package 04-B, not this package's
 * file). `'new'` over `'auto'`/`'current'`: a click that always opens a new window never risks the
 * extension-host shutdown `openFolder`'s `window: 'current'` causes (api-facts.md, fact 10) — a
 * surprising side effect for a setting nobody has touched yet. A user who wants `auto` or `current`
 * opts in explicitly.
 */
export const DEFAULT_ACTION_ID = 'builtin.openInNewWindow';
