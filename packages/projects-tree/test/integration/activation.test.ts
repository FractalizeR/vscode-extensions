/**
 * Round 06 review, codex-04: `extension.activate()` completing without an exception and
 * `Extension.isActive === true` prove only that nothing threw — `createTreeView` (both calls),
 * `registerFileDecorationProvider`, and every command/listener registration in `src/extension.ts`
 * could be deleted wholesale and the original version of this suite would still pass. Two real
 * effects of that composition root are observable through the public API and asserted below:
 *
 * - the commands `activate()` registers (`registerOpenProjectCommand`, `registerRefreshCommand`,
 *   `registerAddRootCommand`) actually exist, per `vscode.commands.getCommands()`;
 * - `projectsTree.refresh` is wired to a real `ProjectsTreeProvider` whose constructor arguments
 *   (`createNodeFileSystemReader()`, `DEFAULT_RULES`, both registries, in the right positions) are
 *   correct enough to walk a real directory on disk without throwing.
 *
 * What stays unobserved by this suite, and why: this test host activates the extension via
 * `onStartupFinished` before any test runs (confirmed empirically: `isActive` is already `true`
 * and every command already registered on the very first test executed, before any test calls
 * `.activate()` itself) — no VS Code API lets an extension host test create a *second*,
 * independent extension host to observe activation from before it happens. Given that, nothing
 * here can prove `createTreeView` ran for *both* view ids specifically: a competing
 * `createTreeView` call for an id that already has a provider neither throws nor reports the
 * existing registration back (verified empirically against the locally cached 1.136.1; no
 * documented, quoted-in-api-facts.md fact says so either way, so this is not asserted). Nor can it
 * prove the `FileDecorationProvider` registration or the two `onDidExpandElement`/
 * `onDidCollapseElement` subscriptions did anything: `activate()` keeps the `TreeView` and
 * `HighlightDecorationProvider` instances private, so nothing outside the module can drive or
 * inspect them, and `DEFAULT_RULES` currently carries no highlight rule (round 06 review,
 * codex-02) — a broken decoration wiring and a working one look identical from here regardless.
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { makeProjectDir, makeTempRoot, removeDir } from './temp-tree.js';

const EXTENSION_ID = 'fractalizer.projects-tree';
const VIEW_IDS = ['projectsTree.view', 'projectsTree.explorerView'];
const REGISTERED_COMMANDS = [
  'projectsTree.openProject',
  'projectsTree.refresh',
  'projectsTree.addRoot',
];

suite('extension activation', () => {
  test('both view ids are contributed and the extension activates cleanly', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} was not found by the test host`);

    // `Extension.packageJSON` is typed `any` (vscode.d.ts) — asserted to the shape this manifest
    // is known to have, rather than accessed through the `any` directly.
    const manifest = extension.packageJSON as {
      contributes?: { views?: Record<string, readonly { id: string }[]> };
    };
    const viewsById = manifest.contributes?.views ?? {};
    const contributedIds = new Set(
      Object.values(viewsById)
        .flat()
        .map((view) => view.id),
    );
    for (const id of VIEW_IDS) {
      assert.ok(contributedIds.has(id), `view id "${id}" missing from package.json`);
    }

    // `activate()` runs `vscode.window.createTreeView(viewId, ...)` for both ids
    // (src/extension.ts) — `createTreeView` creates "a TreeView for the view contributed using
    // the extension point `views`" (api-facts.md, fact 39). Neither `vscode.d.ts` nor this
    // project's api-facts.md documents that an uncontributed id makes `createTreeView` throw, so
    // this assertion proves activation completed without error for both ids, not that a bad id is
    // rejected — the manifest check above is what actually pins the ids down.
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  test('registers every command the composition root wires up', async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of REGISTERED_COMMANDS) {
      assert.ok(commands.includes(id), `command "${id}" was not registered`);
    }
  });

  test('the refresh command runs the real discovery pipeline against a directory on disk', async () => {
    const config = vscode.workspace.getConfiguration('projectsTree');
    const originalRoots = config.get('roots');
    const rootDir = await makeTempRoot('projects-tree-activation');
    try {
      await makeProjectDir(rootDir, 'proj');
      await config.update('roots', [rootDir], vscode.ConfigurationTarget.Global);
      // Throws if any of the composition root's constructor arguments to `ProjectsTreeProvider`
      // are wrong (wrong position, wrong collaborator, a filesystem reader never wired up) —
      // exactly the class of regression `isActive` alone cannot see.
      await vscode.commands.executeCommand('projectsTree.refresh');
    } finally {
      await config.update('roots', originalRoots, vscode.ConfigurationTarget.Global);
      await removeDir(rootDir);
    }
  });
});
