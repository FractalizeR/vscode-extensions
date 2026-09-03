/**
 * `setContext` is the documented way to add a `when`-clause boolean not already exposed by the
 * platform (`docs/plans/projects-tree/api-facts.md`, fact 6). Two groups of keys live here:
 *
 * - `projectsTree.hasRoots` gates the `viewsWelcome` entry (fact 31) that replaces an empty tree
 *   with an explanatory message instead of a blank view;
 * - `projectsTree.locationIs*` gate which of the two views is visible (package 03-C). They are
 *   booleans set from here rather than `config.projectsTree.location == 'activityBar'` in the
 *   `when` clause itself: `config.` in a `when` clause is documented for settings that evaluate to
 *   a boolean, and `location` is a string, so that form has no quote behind it (fact 6).
 */
import * as vscode from 'vscode';
import type { TreeLocation } from './configuration/index.js';
import { locationContextKeys } from './tree-view/location.js';

const ROOTS_CONTEXT_KEY = 'projectsTree.hasRoots';

export async function setHasRoots(hasRoots: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', ROOTS_CONTEXT_KEY, hasRoots);
}

/**
Must be called during activation, not only from the configuration-change listener: without it the
first session after a reload has neither key set, every view's `when` is false, and the user sees no
tree at all (03-C's DoD names this explicitly).
*/
export async function setLocationContextKeys(location: TreeLocation): Promise<void> {
  const keys = locationContextKeys(location);
  for (const [key, value] of Object.entries(keys)) {
    await vscode.commands.executeCommand('setContext', key, value);
  }
}
