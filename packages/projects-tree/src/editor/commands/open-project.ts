/**
 * Minimal action executor for the vertical slice (`docs/plans/projects-tree/04-actions.md`,
 * package 04-A) — only the `openFolder` view, always in a new window. `vscode.openFolder` in the
 * current window shuts down this extension host process (`docs/plans/projects-tree/api-facts.md`,
 * fact 10); the slice keeps no in-memory state worth surviving that, so it never risks it.
 *
 * The full 04-A executor set (`.code-workspace` detection, `window: 'auto'`, the other action
 * views) is out of scope here — see the report for what was deliberately left out.
 */
import * as vscode from 'vscode';
import type { ClassifiedNode } from '../../projects/discovery/index.js';

export const OPEN_PROJECT_COMMAND = 'projectsTree.openProject';

export function registerOpenProjectCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(OPEN_PROJECT_COMMAND, async (node: ClassifiedNode) => {
    const uri = vscode.Uri.file(node.facts.absolutePath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
  });
}
