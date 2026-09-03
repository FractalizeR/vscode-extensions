import * as vscode from 'vscode';

const REFRESH_COMMAND = 'projectsTree.refresh';

/**
Structural, not `ProjectsTreeProvider` itself: importing the concrete type from `../tree-view/`
would make `commands/` and `tree-view/` depend on each other (`tree-view/item.ts` already depends
on `commands/` for `OPEN_PROJECT_COMMAND`), which `no-circular` (`.dependency-cruiser.mjs`) rejects.
*/
interface Refreshable {
  refresh(): Promise<void>;
}

export function registerRefreshCommand(target: Refreshable): vscode.Disposable {
  return vscode.commands.registerCommand(REFRESH_COMMAND, async () => {
    await target.refresh();
  });
}
