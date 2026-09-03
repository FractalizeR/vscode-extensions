import * as vscode from 'vscode';
import { DEFAULT_RULES } from './projects/classification/index.js';
import { createNodeFileSystemReader } from './projects/discovery/index.js';
import { registerOpenProjectCommand, registerRefreshCommand } from './editor/commands/index.js';
import {
  onTreeConfigurationChanged,
  readRoots,
  readShowRootNodes,
} from './editor/configuration/index.js';
import { setHasRoots } from './editor/context-keys.js';
import { NodeRegistry, ProjectsTreeProvider, RootGroupRegistry } from './editor/tree-view/index.js';

const VIEW_ID = 'projectsTree.view';

export function activate(context: vscode.ExtensionContext): void {
  const nodeRegistry = new NodeRegistry();
  const groupRegistry = new RootGroupRegistry();
  const provider = new ProjectsTreeProvider(
    () => readRoots().roots,
    readShowRootNodes,
    createNodeFileSystemReader(),
    DEFAULT_RULES,
    nodeRegistry,
    groupRegistry,
  );

  const refreshFromSettings = async (): Promise<void> => {
    const { roots, invalid } = readRoots();
    if (invalid.length > 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Ignoring {0} invalid entry/entries in projectsTree.roots — each must be an absolute path, or an object with an absolute "path".',
          invalid.length,
        ),
      );
    }
    await setHasRoots(roots.length > 0);
    await provider.refresh();
  };

  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    registerOpenProjectCommand(),
    registerRefreshCommand(provider),
    onTreeConfigurationChanged(() => void refreshFromSettings()),
  );

  void refreshFromSettings();
}

export function deactivate(): void {
  // Intentionally empty: every disposable was registered through context.subscriptions.
}
