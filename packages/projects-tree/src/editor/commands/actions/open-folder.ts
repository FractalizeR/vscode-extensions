import * as fs from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import type { ActionRenderNode, ActionSpec } from '../../../projects/actions/index.js';

export type OpenFolderSpec = Extract<ActionSpec, { kind: 'openFolder' }>;

/**
 * `window: 'current'` shuts down and restarts this extension host process
 * (api-facts.md, fact 10) — nothing in memory survives it, so this executor holds nothing back for
 * "afterward": by the time it would matter, this code is not running anymore.
 *
 * Reads the project directory once, for two purposes at once: finding a `.code-workspace` file
 * (opened instead of the folder itself — prototype behavior the plan calls out) and detecting a
 * project directory that no longer exists (`readdir` rejects with `ENOENT`) — the "project applies
 * but was deleted" boundary case, reported the same way as any other read failure rather than as a
 * silent no-op or an uncaught rejection.
 */
export async function runOpenFolder(spec: OpenFolderSpec, node: ActionRenderNode): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(node.path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(vscode.l10n.t('Cannot open "{0}": {1}', node.path, reason));
    return;
  }

  // Picks the lexicographically first match for a deterministic result when a project somehow
  // carries more than one — `readdir`'s own order is filesystem-dependent, not name order. A plain
  // loop, not `.sort()`/`.toSorted()`: this tsconfig's `lib` (`ES2022`) predates `Array#toSorted`,
  // and the in-place `.sort()` alternative is exactly what that omission exists to steer away from.
  let workspaceFile: string | undefined;
  for (const entry of entries) {
    if (
      entry.endsWith('.code-workspace') &&
      (workspaceFile === undefined || entry < workspaceFile)
    ) {
      workspaceFile = entry;
    }
  }
  const targetUri = vscode.Uri.file(
    workspaceFile === undefined ? node.path : path.join(node.path, workspaceFile),
  );

  await vscode.commands.executeCommand('vscode.openFolder', targetUri, {
    forceNewWindow: shouldForceNewWindow(spec.window),
  });
}

/**
 * `'auto'`: a new window if the current one already has a folder open — reusing it would discard
 * whatever the user is already doing there. Nothing open yet means the current (empty) window is
 * free to take the project directly, no new window needed.
 */
function shouldForceNewWindow(window: OpenFolderSpec['window']): boolean {
  switch (window) {
    case 'new': {
      return true;
    }
    case 'current': {
      return false;
    }
    case 'auto': {
      const folders = vscode.workspace.workspaceFolders;
      return folders !== undefined && folders.length > 0;
    }
  }
}
