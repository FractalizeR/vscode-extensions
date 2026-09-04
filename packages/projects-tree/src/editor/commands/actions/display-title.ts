import * as vscode from 'vscode';
import { BUILT_IN_ACTIONS, type ActionDefinition } from '../../../projects/actions/index.js';

/**
 * Localized display title for one of the fixed `BUILT_IN_ACTIONS` — `builtin.ts` deliberately
 * carries no `title` (see its own doc comment, R07-L10N-BYPASS): the core cannot import `vscode`,
 * so it cannot localize, and this adapter is the point of display instead. A `switch` over the
 * known, closed set of built-in ids, not a lookup table indexed by array position: adding a fourth
 * built-in means adding a `case` here, and a missing one fails loudly (`default` falls through to
 * `displayTitleFor`'s own `action.id` fallback) rather than silently reusing a neighbor's title.
 */
function builtinTitle(id: string): string | undefined {
  switch (id) {
    case 'builtin.openInNewWindow': {
      return vscode.l10n.t('Open in New Window');
    }
    case 'builtin.openInCurrentWindow': {
      return vscode.l10n.t('Open in Current Window');
    }
    case 'builtin.openAuto': {
      return vscode.l10n.t('Open');
    }
    default: {
      return undefined;
    }
  }
}

/**
 * The one place an `ActionDefinition.title` becomes UI text. Two different things share that field
 * and must not be treated the same way (R07-L10N-BYPASS):
 *
 * - one of the fixed `BUILT_IN_ACTIONS` objects (checked by **reference**, via `.includes` — not by
 *   `id`) gets a localized title from `builtinTitle`, ignoring whatever `.title` it happens to carry
 *   (it carries none, by construction);
 * - anything else — including a rules-file action whose author reused a built-in `id` to override it
 *   (`registry.ts`'s "a file-declared action with the same id as a built-in wins" — the object in
 *   the registry is then the file's own, not `BUILT_IN_ACTIONS`'s, so the reference check correctly
 *   falls through here) — shows its own `title` verbatim, exactly as the file author wrote it. That
 *   text is user data, not this extension's UI string; translating it would be as wrong as showing
 *   English silently would be for a built-in.
 *
 * Falls back to `action.id` when there is no title to show at all (a file action that declared
 * none) — the existing behavior every call site already relied on before this fix.
 */
export function displayTitleFor(action: ActionDefinition): string {
  if (BUILT_IN_ACTIONS.includes(action)) {
    return builtinTitle(action.id) ?? action.id;
  }
  return action.title ?? action.id;
}
