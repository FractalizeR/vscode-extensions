/**
 * `setContext` is the documented way to add a `when`-clause boolean not already exposed by the
 * platform (`docs/plans/projects-tree/api-facts.md`, fact 6). `projectsTree.hasRoots` gates the
 * `viewsWelcome` entry (fact 31) that replaces an empty tree with an explanatory message instead
 * of a blank view.
 */
import * as vscode from 'vscode';

const ROOTS_CONTEXT_KEY = 'projectsTree.hasRoots';

export async function setHasRoots(hasRoots: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', ROOTS_CONTEXT_KEY, hasRoots);
}
