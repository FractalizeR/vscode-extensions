import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'fractalizer.projects-tree';
const VIEW_IDS = ['projectsTree.view', 'projectsTree.explorerView'];

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
});
