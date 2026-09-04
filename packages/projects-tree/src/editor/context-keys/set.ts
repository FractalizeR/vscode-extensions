/**
 * Pushes this extension's context keys into the platform. The names live in `names.js`; this file
 * is only the `setContext` calls, which is why it is the half that needs `vscode`.
 */
import * as vscode from 'vscode';
import type { TreeLocation } from '../configuration/index.js';
import { locationContextKeys, ROOTS_CONTEXT_KEY } from './names.js';

export async function setHasRoots(hasRoots: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', ROOTS_CONTEXT_KEY, hasRoots);
}

/**
Must be called during activation, not only from the configuration-change listener: without it the
first session after a reload has neither key set, every view's `when` is false, and the user sees no
tree at all (03-C's DoD names this explicitly).
*/
export async function setLocationContextKeys(location: TreeLocation): Promise<void> {
  const keys = Object.entries(locationContextKeys(location));
  for (const [key, value] of keys) {
    await vscode.commands.executeCommand('setContext', key, value);
  }
}
