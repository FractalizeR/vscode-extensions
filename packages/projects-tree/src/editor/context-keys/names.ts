/**
 * The `when`-clause context keys this extension owns, as plain data. Split from the code that sets
 * them because setting requires `vscode` while the names are exactly what a manifest-contract test
 * must compare against: `when` clauses reference these keys as bare strings, so the only thing that
 * can catch a rename on one side is a test reading both sides — and it cannot import a module that
 * needs a running editor.
 *
 * `setContext` is the documented way to add a `when`-clause boolean the platform does not already
 * expose (`docs/plans/projects-tree/api-facts.md`, fact 6).
 */
import type { TreeLocation } from '../configuration/index.js';

/**
Gates the `viewsWelcome` entry (fact 31) that replaces an empty tree with an explanatory message
instead of a blank view.
*/
export const ROOTS_CONTEXT_KEY = 'projectsTree.hasRoots';

/**
Which of the two views is visible (package 03-C). Booleans set from code rather than
`config.projectsTree.location == 'activityBar'` in the `when` clause itself: `config.` in a `when`
clause is documented for settings that evaluate to a boolean, and `location` is a string, so that
form has no quote behind it (fact 6).
*/
export interface LocationContextKeys {
  readonly 'projectsTree.locationIsActivityBar': boolean;
  readonly 'projectsTree.locationIsExplorer': boolean;
}

export function locationContextKeys(location: TreeLocation): LocationContextKeys {
  return {
    'projectsTree.locationIsActivityBar': location === 'activityBar',
    'projectsTree.locationIsExplorer': location === 'explorer',
  };
}
