import * as vscode from 'vscode';
import { DEFAULT_RULES } from './projects/classification/index.js';
import { createNodeFileSystemReader } from './projects/discovery/index.js';
import {
  registerAddRootCommand,
  registerOpenProjectCommand,
  registerRefreshCommand,
} from './editor/commands/index.js';
import {
  onTreeConfigurationChanged,
  readLocation,
  readRoots,
  readShowRootNodes,
} from './editor/configuration/index.js';
import { setHasRoots, setLocationContextKeys } from './editor/context-keys.js';
import {
  ALL_VIEW_IDS,
  ExpansionStore,
  NodeRegistry,
  ProjectsTreeProvider,
  RootGroupRegistry,
  treeElementKey,
  type TreeElement,
} from './editor/tree-view/index.js';

export function activate(context: vscode.ExtensionContext): void {
  const nodeRegistry = new NodeRegistry();
  const groupRegistry = new RootGroupRegistry();
  const expansion = new ExpansionStore(context.globalState);
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
    // Both keys are set on every pass, including the first: a `when` clause reading an unset key is
    // false, so skipping this at activation would show no tree at all until the user happened to
    // edit a setting (03-C's DoD names exactly this).
    await setLocationContextKeys(readLocation());
    await setHasRoots(roots.length > 0);
    await provider.refresh();
  };

  context.subscriptions.push(
    provider,
    // `createTreeView`, not `registerTreeDataProvider`: only a `TreeView` exposes
    // `onDidExpandElement`/`onDidCollapseElement` (api-facts.md, facts 39, 40), and without those
    // the expansion store has nothing to record. Registered on both view ids unconditionally —
    // `when` decides which one is visible, so switching `projectsTree.location` needs no
    // re-registration (see `tree-view/location.ts`).
    ...ALL_VIEW_IDS.flatMap((viewId) => {
      const view = vscode.window.createTreeView<TreeElement>(viewId, {
        treeDataProvider: provider,
        showCollapseAll: true,
      });
      return [
        view,
        view.onDidExpandElement((event) => {
          void expansion.record(treeElementKey(event.element), true);
        }),
        view.onDidCollapseElement((event) => {
          void expansion.record(treeElementKey(event.element), false);
        }),
      ];
    }),
    registerOpenProjectCommand(),
    registerRefreshCommand(provider),
    registerAddRootCommand(),
    onTreeConfigurationChanged(() => void refreshFromSettings()),
  );

  void refreshFromSettings();
}

export function deactivate(): void {
  // Intentionally empty: every disposable was registered through context.subscriptions.
}
