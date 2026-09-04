import * as vscode from 'vscode';
import { DEFAULT_RULES, type Rule } from './projects/classification/index.js';
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
import { setHasRoots, setLocationContextKeys } from './editor/context-keys/index.js';
import { HighlightDecorationProvider } from './editor/decorations/index.js';
import { loadCanonicalRules } from './editor/rules/index.js';
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
  const decorations = new HighlightDecorationProvider();
  const provider = new ProjectsTreeProvider(
    // `none` means the user asked for no tree, so the provider is given no roots and its existing
    // empty-tree path does the rest. Not an optimization but a correctness point: the walk reads
    // every configured root from disk in every editor window (now on every startup, since
    // `onStartupFinished`), and its result feeds the decoration provider — which is global (fact 8)
    // and would keep colouring the Explorer in the one mode where the user asked to see nothing
    // (round 06 review, claude-10).
    () => (readLocation() === 'none' ? [] : readRoots().roots),
    readShowRootNodes,
    createNodeFileSystemReader(),
    () => rules,
    nodeRegistry,
    groupRegistry,
    expansion,
    decorations,
  );

  // Remembers which invalid entries the user was last told about. Without it the same warning
  // reappears on every configuration change that this listener watches — so one typo in `roots`
  // produced a toast each time the user touched `location` or `showRootNodes`, which is precisely
  // while they are already looking at the setting (round 06 review, claude-11).
  let reportedInvalid = '';
  let reportedDuplicates = '';
  // The rules the provider is currently classifying with. Held here rather than captured by the
  // provider so an edit to the rules file takes effect on the next refresh; the provider reads it
  // through the supplier below.
  let rules: readonly Rule[] = DEFAULT_RULES;
  let reportedRuleProblems = 0;

  const refreshFromSettings = async (): Promise<void> => {
    const { roots, invalid, duplicates } = readRoots();
    const invalidSignature = invalid.join('\u{0}');
    if (invalidSignature !== reportedInvalid && invalid.length > 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Ignoring {0} invalid entry/entries in projectsTree.roots — each must be an absolute path, or an object with an absolute "path".',
          invalid.length,
        ),
      );
    }
    reportedInvalid = invalidSignature;

    const duplicateSignature = duplicates.join('\u{0}');
    if (duplicateSignature !== reportedDuplicates && duplicates.length > 0) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Ignoring {0} duplicate entry/entries in projectsTree.roots — each root must be configured only once.',
          duplicates.length,
        ),
      );
    }
    reportedDuplicates = duplicateSignature;

    // Both keys are set on every pass, including the first: a `when` clause reading an unset key is
    // false, so skipping this at activation would show no tree at all until the user happened to
    // edit a setting (03-C's DoD names exactly this).
    // Re-read on every pass: the canonical rules file is edited outside the editor, and a watcher
    // is `07-cache-and-reactivity.md`'s subject. A rules change must reset both identity registries
    // — every node's verdict may differ, so the canonical objects no longer describe the same tree
    // (03-A: «реестр сбрасывается при смене правил или корней»).
    const loaded = await loadCanonicalRules(context);
    if (JSON.stringify(loaded.rules) !== JSON.stringify(rules)) {
      rules = loaded.rules;
      nodeRegistry.invalidate();
      groupRegistry.invalidate();
    }
    if (loaded.diagnostics.length > 0 && loaded.diagnostics.length !== reportedRuleProblems) {
      void vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Ignoring the projects-tree.rules.json file — it has {0} problem(s); using default rules instead.',
          loaded.diagnostics.length,
        ),
      );
    }
    reportedRuleProblems = loaded.diagnostics.length;

    const location = readLocation();
    await setLocationContextKeys(location);
    await setHasRoots(roots.length > 0);

    await provider.refresh();
  };

  context.subscriptions.push(
    provider,
    decorations,
    // Registered before the first refresh so the initial tree is decorated too. The provider is
    // global (api-facts.md, fact 8): these decorations also appear in the Explorer, and the user
    // can switch them off entirely via `explorer.decorations.colors`/`.badges` (fact 28) — which
    // is why highlighting never relies on this carrier alone.
    vscode.window.registerFileDecorationProvider(decorations),
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
