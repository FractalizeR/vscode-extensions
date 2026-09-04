/**
 * Minimal slice of `docs/plans/projects-tree/04-actions.md`, package 04-E ("Add Root…") — only
 * adding a root through a native folder picker. Editing `projectsTree.roots` by hand was the only
 * way in, and after labels turned it into `oneOf[string, {path,label?}]`, Settings UI cannot render
 * it as a list at all — it falls back to "Edit in settings.json" (VS Code renders `oneOf` items
 * that way; there is no per-schema-branch list editor). "Remove Root" needs a context menu on a
 * root group node and is the rest of 04-E — out of scope here.
 */
import * as vscode from 'vscode';
import { mergeRoots } from '../configuration/merge-roots.js';
import { readRoots } from '../configuration/index.js';

const ADD_ROOT_COMMAND = 'projectsTree.addRoot';

const SECTION = 'projectsTree';

export function registerAddRootCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(ADD_ROOT_COMMAND, async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: true,
      openLabel: vscode.l10n.t('Add as Project Root'),
    });
    if (picked === undefined || picked.length === 0) return;

    const { roots } = readRoots();
    const merged = mergeRoots(
      roots,
      picked.map((uri) => uri.fsPath),
    );
    // `projectsTree.roots` is `scope: machine` (api-facts.md, fact 18): only user or remote
    // settings apply, so it is written to ConfigurationTarget.Global — writing it to the
    // workspace would be silently ignored by whoever reads it back.
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', merged, vscode.ConfigurationTarget.Global);
  });
}
