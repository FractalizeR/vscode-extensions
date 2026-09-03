/**
 * `projectsTree.location`'s three values are read by `src/extension.ts`'s configuration-change
 * listener, which calls `setLocationContextKeys` (src/editor/context-keys.ts) through
 * `vscode.commands.executeCommand('setContext', ...)`. There is no documented, quoted-in-
 * api-facts.md API for an extension to read back a context key's current value, so this suite
 * cannot assert on `projectsTree.locationIsActivityBar`/`.locationIsExplorer` directly. What it
 * asserts instead: switching between all three modes completes without throwing, and — since a
 * window reload tears down and restarts the whole extension host, which would kill this very test
 * process mid-suite — simply finishing every mode switch inside one running test is itself
 * evidence that no reload happened.
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const SECTION = 'projectsTree';
const LOCATIONS = ['activityBar', 'explorer', 'none', 'activityBar'] as const;

suite('switching projectsTree.location', () => {
  const originalLocation = vscode.workspace.getConfiguration(SECTION).get<string>('location');

  teardown(async () => {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('location', originalLocation, vscode.ConfigurationTarget.Global);
  });

  test('every mode takes effect immediately, without a reload', async () => {
    const extensionId = 'fractalizer.projects-tree';
    // `onView:*` activation events (package.json) only fire once a contributed view is actually
    // rendered, which this suite never does — activate explicitly so `isActive` below reflects
    // this test's own actions instead of depending on some other suite having triggered it first
    // (mocha does not guarantee suite/file order).
    await vscode.extensions.getExtension(extensionId)?.activate();
    for (const location of LOCATIONS) {
      await vscode.workspace
        .getConfiguration(SECTION)
        .update('location', location, vscode.ConfigurationTarget.Global);
      assert.equal(vscode.workspace.getConfiguration(SECTION).get('location'), location);
      // Reached only if the extension host is still the one that started this test — a reload
      // would have ended the process before this line ran again for the next mode.
      assert.equal(vscode.extensions.getExtension(extensionId)?.isActive, true);
    }
  });
});
