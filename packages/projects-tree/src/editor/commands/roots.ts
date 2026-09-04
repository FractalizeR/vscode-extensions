/**
 * `docs/plans/projects-tree/04-actions.md`, package 04-E: "Add Root…" and "Remove Root" are the two
 * ways `projectsTree.roots` is edited by the extension rather than by hand — one module, since both
 * are the same operation ("write the setting back with a different list") on either side of it, and
 * they already share `mergeRoots`'s raw-entry serialization (`configuration/merge-roots.ts`).
 *
 * "Add Root…" was previously its own file (`add-root.ts`); this module absorbs it rather than
 * leaving "Remove Root" to duplicate the `ConfigurationTarget.Global` write and its own reasoning
 * for using it.
 */
import * as vscode from 'vscode';
import { mergeRoots } from '../configuration/merge-roots.js';
import { readRoots } from '../configuration/index.js';

export const ADD_ROOT_COMMAND = 'projectsTree.addRoot';
export const REMOVE_ROOT_COMMAND = 'projectsTree.removeRoot';

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

/**
 * Structural mirror of `tree-view/root-group.ts`'s `RootGroupNode` — the two fields this command
 * actually reads off it. Not imported directly: `tree-view/item.ts` already imports
 * `RUN_PRIMARY_ACTION_COMMAND` from `commands/`, so the reverse edge (`commands/` importing
 * `tree-view/`) would be a cycle `no-circular` (`.dependency-cruiser.mjs`) rejects — the same
 * constraint `node-selection.ts`'s own doc comment states for `Refreshable`. VS Code passes the real
 * `RootGroupNode` object as this command's first argument when invoked from `view/item/context`
 * (the mechanism `open-in-window.ts`'s `explicitNode` already relies on for `ClassifiedNode`).
 */
interface RootGroupArg {
  readonly rootId: string;
  readonly label: string;
}

function isRootGroupArg(value: unknown): value is RootGroupArg {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { rootId?: unknown }).rootId === 'string' &&
    typeof (value as { label?: unknown }).label === 'string'
  );
}

interface RootQuickPickItem extends vscode.QuickPickItem {
  readonly rootId: string;
}

/**
 * The fallback path for every invocation that supplies no `RootGroupArg` — the Command Palette
 * always calls a command with no arguments, and `rootGroup` context-menu items only exist for a
 * `RootGroupNode`, which the tree does not create for a single root under `showRootNodes: "auto"`
 * or for any root count under `"never"` (R07-REMOVE-ROOT). A QuickPick over `projectsTree.roots`
 * gives both cases a path to removal that does not depend on that synthetic node existing.
 */
async function pickRootToRemove(): Promise<RootGroupArg | undefined> {
  const { roots } = readRoots();
  if (roots.length === 0) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('No project roots are configured yet. Add one with "Add Root Folder…".'),
    );
    return undefined;
  }

  const items: RootQuickPickItem[] = roots.map((root) => ({
    label: root.label ?? root.id,
    rootId: root.id,
    ...(root.label !== undefined && { description: root.id }),
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Select a root to remove'),
  });
  return picked === undefined ? undefined : { rootId: picked.rootId, label: picked.label };
}

/**
 * "Remove Root": modal confirmation (accidental deletion of a whole tree of projects from the
 * setting is not something a toast-dismiss should undo silently), then a plain `roots` rewrite with
 * the matching entry dropped. Reuses `mergeRoots(remaining, [])` — an empty `newPaths` makes it a
 * pure "re-serialize these `ConfiguredRoot`s back to their raw setting shape" call, exactly what
 * removal needs and what would otherwise be a second, hand-written copy of `mergeRoots`'s own
 * string-vs-`{path,label}` decision.
 */
export function registerRemoveRootCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(REMOVE_ROOT_COMMAND, async (explicitGroup?: unknown) => {
    const target = isRootGroupArg(explicitGroup) ? explicitGroup : await pickRootToRemove();
    if (target === undefined) return;

    const confirm = vscode.l10n.t('Remove');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'Remove root "{0}" from projectsTree.roots? This only changes the setting — nothing on disk is deleted.',
        target.label,
      ),
      { modal: true },
      confirm,
    );
    if (choice !== confirm) return;

    const { roots } = readRoots();
    const remaining = roots.filter((root) => root.id !== target.rootId);
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', mergeRoots(remaining, []), vscode.ConfigurationTarget.Global);
    // No explicit refresh call: `onTreeConfigurationChanged` (`configuration/settings.ts`) already
    // fires from this same `update()` (api-facts.md, fact 38 — no carve-out for the extension's own
    // write) and drives `refreshFromSettings` in `extension.ts`.
  });
}
