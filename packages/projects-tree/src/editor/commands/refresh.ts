import * as vscode from 'vscode';

export const REFRESH_COMMAND = 'projectsTree.refresh';

/**
`reload` must be the same full reload pipeline `extension.ts` runs on a settings change and on a
rules-file write from "Hide"/"Manage Hidden…" — re-reading `projects-tree.rules.json`, rebuilding
the action registry, invalidating `NodeRegistry`/`RootGroupRegistry`/`ProjectListCache`, then
refreshing the tree provider (`extension.ts`'s `refreshFromSettings`). Taking only
`ProjectsTreeProvider.refresh()` here previously left every one of those a manual file edit relies
on unreached (R07-REFRESH): the button re-rendered the same stale tree from the same stale rules
and stale cached project list.
*/
export function registerRefreshCommand(reload: () => Promise<void>): vscode.Disposable {
  return vscode.commands.registerCommand(REFRESH_COMMAND, async () => {
    await reload();
  });
}
