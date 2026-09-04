import * as vscode from 'vscode';
import { BUILT_IN_ACTIONS } from './projects/actions/index.js';
import { DEFAULT_RULES, type Rule } from './projects/classification/index.js';
import { createNodeFileSystemReader } from './projects/discovery/index.js';
import {
  createActionRegistry,
  createActionRunner,
  ProjectListCache,
  registerAddRootCommand,
  registerHideCommand,
  registerManageHiddenCommand,
  registerOpenInWindowCommands,
  registerOpenProjectCommand,
  registerRefreshCommand,
  registerRemoveRootCommand,
  registerRunActionCommand,
  registerRunPrimaryActionCommand,
  registerShowActionsCommand,
  type ActionRegistry,
  type NodeSelection,
} from './editor/commands/index.js';
import {
  createWorkspaceTrustExecutionGate,
  onTreeConfigurationChanged,
  readDefaultAction,
  readLocation,
  readMaxDepth,
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
// Not re-exported from `tree-view/index.js` (that surface names only what a consumer outside the
// directory has needed so far); the composition root is one such consumer, for exactly one thing —
// telling a `ClassifiedNode` selection apart from a `RootGroupNode` one when computing
// `NodeSelection.currentProjectNode()` below. Importing the file directly, rather than growing the
// index for a single re-export, keeps that surface's own scope decision with the package that owns
// it (package 03-C), not this one.
import { isRootGroupNode } from './editor/tree-view/root-group.js';

// Ids a rules file's `primaryAction` may reference besides whatever it declares itself
// (`loadRulesFile`'s `knownActionIds` parameter) — closes the debt `canonical-rules.ts` previously
// left open by always passing `[]`.
const BUILT_IN_ACTION_IDS = BUILT_IN_ACTIONS.map((action) => action.id);

export function activate(context: vscode.ExtensionContext): void {
  const nodeRegistry = new NodeRegistry();
  const groupRegistry = new RootGroupRegistry();
  const expansion = new ExpansionStore(context.globalState);
  const decorations = new HighlightDecorationProvider();
  // Gates `terminal`/`process`/`command` actions (04-actions.md, package 04-B).
  const executionGate = createWorkspaceTrustExecutionGate(context);
  const actionRunner = createActionRunner(executionGate);
  // Shared with the tree provider below: one `FileSystemReader` instance, not two, so a fake
  // substituted in a test double reaches both the tree walk and `projectsTree.openProject`'s own
  // walk (04-actions.md, package 04-D) — the walk 04-D needs since there is no background cache.
  const fs = createNodeFileSystemReader();
  // Session-scoped list for `projectsTree.openProject` (package 04-D) — the only way to use the
  // extension in `location: 'none'`. Invalidated alongside `nodeRegistry`/`groupRegistry` below,
  // on the same triggers `refreshFromSettings` already tracks, not on a timer or a subscription of
  // its own (04-D task text): unlike those two identity registries, this cache has no incremental
  // repair path (`canonicalize`/`retainOnly`) and must be dropped outright on any change that could
  // change which projects exist — rules, roots, or `maxDepth`.
  const projectListCache = new ProjectListCache();
  // Rebuilt whenever the rules file's own `actions` change (see `refreshFromSettings` below) — a
  // command handler must read this through a supplier, never close over one instance, or an edit
  // to the rules file's actions would need a window reload to take effect (same reasoning
  // `ProjectsTreeProvider`'s `listRules` supplier documents for rules themselves).
  let actionRegistry: ActionRegistry = createActionRegistry([]);
  const provider = new ProjectsTreeProvider(
    // `none` means the user asked for no tree, so the provider is given no roots and its existing
    // empty-tree path does the rest. Not an optimization but a correctness point: the walk reads
    // every configured root from disk in every editor window (now on every startup, since
    // `onStartupFinished`), and its result feeds the decoration provider — which is global (fact 8)
    // and would keep colouring the Explorer in the one mode where the user asked to see nothing
    // (round 06 review, claude-10).
    () => (readLocation() === 'none' ? [] : readRoots().roots),
    readShowRootNodes,
    fs,
    () => rules,
    nodeRegistry,
    groupRegistry,
    expansion,
    readMaxDepth,
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
  // Tracks what `projectListCache` was last built against — `NodeRegistry`/`RootGroupRegistry`
  // don't need this (they self-repair via `canonicalize`/`retainOnly` on a roots change), but the
  // flat project list has no such repair path and must be dropped outright when either changes.
  let previousRootsSignature: string | undefined;
  let previousMaxDepth: number | undefined;

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
    const loaded = await loadCanonicalRules(context, BUILT_IN_ACTION_IDS);
    if (JSON.stringify(loaded.rules) !== JSON.stringify(rules)) {
      rules = loaded.rules;
      nodeRegistry.invalidate();
      groupRegistry.invalidate();
      projectListCache.invalidate();
    }

    // `roots`/`maxDepth` each get their own signature check, independent of the rules one above:
    // `NodeRegistry`/`RootGroupRegistry` don't need this (a roots change is repaired incrementally
    // by `retainOnly`), but `projectListCache` holds a flat list with no such repair — a root added,
    // removed, or `maxDepth` changed means the list is simply wrong until rebuilt.
    const rootsSignature = roots.map((root) => root.id).join('\u{0}');
    const maxDepth = readMaxDepth();
    if (rootsSignature !== previousRootsSignature || maxDepth !== previousMaxDepth) {
      projectListCache.invalidate();
    }
    previousRootsSignature = rootsSignature;
    previousMaxDepth = maxDepth;

    // Rebuilt unconditionally, unlike `rules` above: a registry carries no per-node identity for
    // `NodeRegistry`/`RootGroupRegistry` to preserve, so there is no cost to paying for "did the
    // actions actually change" the way there is for a full tree invalidation.
    actionRegistry = createActionRegistry(loaded.actions);
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

  // `createTreeView`, not `registerTreeDataProvider`: only a `TreeView` exposes
  // `onDidExpandElement`/`onDidCollapseElement` (api-facts.md, facts 39, 40), and without those
  // the expansion store has nothing to record. Registered on both view ids unconditionally —
  // `when` decides which one is visible, so switching `projectsTree.location` needs no
  // re-registration (see `tree-view/location.ts`). Held in a local, not just pushed straight into
  // `context.subscriptions`, because `nodeSelection` below needs to read `.selection` back off
  // both of them.
  const views = ALL_VIEW_IDS.map((viewId) =>
    vscode.window.createTreeView<TreeElement>(viewId, {
      treeDataProvider: provider,
      showCollapseAll: true,
    }),
  );

  /**
  The composition root's implementation of `commands/node-selection.ts`'s structural seam: a command
  invoked without an explicit node (a keybinding's `args`, or the Command Palette — api-facts.md,
  fact 29) falls back to whichever project node is selected in either view (fact 75:
  `TreeView.selection` is synchronous). Only one of the two views is visible at a time (`location`),
  but both exist regardless, so both are checked; a `RootGroupNode` or a non-project folder in the
  selection is not a valid action target and yields `undefined`, same as an empty selection.
  */
  const nodeSelection: NodeSelection = {
    currentProjectNode: () => {
      for (const view of views) {
        const [selected] = view.selection;
        if (
          selected !== undefined &&
          !isRootGroupNode(selected) &&
          selected.verdict.project.value
        ) {
          return selected;
        }
      }
      return;
    },
    // "Hide" (package 04-E) targets any node, not only a project — a plain folder the default
    // rules did not already catch is exactly what a user hides. Still excludes a `RootGroupNode`:
    // that carries no `Verdict`/`facts` to build a hide rule from, and has its own command
    // ("Remove Root") for the analogous "make this go away" action.
    currentNode: () => {
      for (const view of views) {
        const [selected] = view.selection;
        if (selected !== undefined && !isRootGroupNode(selected)) return selected;
      }
      return;
    },
  };

  context.subscriptions.push(
    provider,
    decorations,
    // Registered before the first refresh so the initial tree is decorated too. The provider is
    // global (api-facts.md, fact 8): these decorations also appear in the Explorer, and the user
    // can switch them off entirely via `explorer.decorations.colors`/`.badges` (fact 28) — which
    // is why highlighting never relies on this carrier alone.
    vscode.window.registerFileDecorationProvider(decorations),
    ...views.flatMap((view) => [
      view,
      view.onDidExpandElement((event) => {
        void expansion.record(treeElementKey(event.element), true);
      }),
      view.onDidCollapseElement((event) => {
        void expansion.record(treeElementKey(event.element), false);
      }),
    ]),
    // `refreshFromSettings`, not `provider` alone: Refresh must re-read the rules file and
    // invalidate the action registry / project-list cache the same way a settings change or a
    // Hide/Manage Hidden write already does, or a manual edit to `projects-tree.rules.json` would
    // not be visible until the window is reloaded (R07-REFRESH).
    registerRefreshCommand(refreshFromSettings),
    registerAddRootCommand(),
    registerRemoveRootCommand(),
    // `refreshFromSettings` directly, not a wrapper: writing the rules file does not itself notify
    // the tree — the same re-read/diff/invalidate pass a hand-edit of the file relies on
    // (`refreshFromSettings`'s own comments on the rules signature check) is what makes a "Hide" or
    // "Manage Hidden…" edit visible without a Reload Window (04-actions.md, package 04-E DoD).
    registerHideCommand(context, BUILT_IN_ACTION_IDS, refreshFromSettings, nodeSelection, fs),
    registerManageHiddenCommand(context, BUILT_IN_ACTION_IDS, refreshFromSettings),
    registerRunPrimaryActionCommand(
      () => actionRegistry,
      actionRunner,
      nodeSelection,
      readDefaultAction,
    ),
    registerRunActionCommand(() => actionRegistry, actionRunner, nodeSelection),
    registerShowActionsCommand(() => actionRegistry, actionRunner, nodeSelection),
    ...registerOpenInWindowCommands(() => actionRegistry, actionRunner, nodeSelection),
    // Registered unconditionally, not only when `location !== 'none'`: this command is the sole way
    // to use the extension in `location: 'none'` (04-actions.md, package 04-D), so it cannot depend
    // on a view — or on `location` at all — to exist. `readRoots` directly, not the provider's own
    // roots supplier: that one collapses to `[]` in `'none'` on purpose (see its own comment above).
    registerOpenProjectCommand(
      projectListCache,
      () => readRoots().roots,
      () => rules,
      readMaxDepth,
      fs,
    ),
    onTreeConfigurationChanged(() => void refreshFromSettings()),
    // No `vscode.workspace.onDidGrantWorkspaceTrust` listener here: it used to force a
    // `refreshFromSettings()` run so a now-removed `when`-clause context key (see `trust.ts`) picked
    // up a trust change without a reload. `ExecutionGate.check()` (`configuration/trust.ts`) already
    // reads `vscode.workspace.isTrusted` fresh on every call — the only remaining consumer of trust
    // — so re-running the whole settings refresh (a full disk walk) on a trust grant would do work
    // with no observable effect, the same defect class this package already removed once above.
  );

  void refreshFromSettings();
}

export function deactivate(): void {
  // Intentionally empty: every disposable was registered through context.subscriptions.
}
