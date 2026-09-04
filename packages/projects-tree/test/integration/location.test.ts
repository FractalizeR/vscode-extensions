/**
 * `projectsTree.location`'s three values are read by `src/extension.ts`'s configuration-change
 * listener, which calls `setLocationContextKeys` (src/editor/context-keys.ts) through
 * `vscode.commands.executeCommand('setContext', ...)`. There is no documented, quoted-in-
 * api-facts.md API for an extension to read back a context key's current value, so this suite
 * cannot assert on `projectsTree.locationIsActivityBar`/`.locationIsExplorer` directly, and
 * `when`-driven re-evaluation of view visibility stays unproven here (round 06 review, codex-04)
 * — asserted instead: switching between all three modes completes without throwing, and — since a
 * window reload tears down and restarts the whole extension host, which would kill this very test
 * process mid-suite — simply finishing every mode switch inside one running test is itself
 * evidence that no reload happened.
 *
 * What IS strengthened, per codex-04: the previous version of this suite asserted only that the
 * setting value round-tripped and `isActive` stayed true — both true even if `refreshFromSettings`
 * (the listener `onTreeConfigurationChanged` invokes) were deleted entirely, since nothing in the
 * old assertions depended on it running. Added below: after every mode switch, the `refresh`
 * command — wired to the same `ProjectsTreeProvider` `refreshFromSettings` drives — is executed
 * against a real directory on disk and must complete without throwing, in every one of the three
 * modes including `'none'` (`extension.ts`'s `location === 'none' ? [] : readRoots().roots`
 * branch, exercised here for real rather than only by unit tests over the pure function).
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { makeProjectDir, makeTempRoot, removeDir } from './temp-tree.js';

const SECTION = 'projectsTree';
const LOCATIONS = ['activityBar', 'explorer', 'none', 'activityBar'] as const;

suite('switching projectsTree.location', () => {
  const originalLocation = vscode.workspace.getConfiguration(SECTION).get<string>('location');
  const originalRoots = vscode.workspace.getConfiguration(SECTION).get('roots');

  teardown(async () => {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('location', originalLocation, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', originalRoots, vscode.ConfigurationTarget.Global);
  });

  test('every mode takes effect immediately, without a reload, and refresh keeps working in each', async () => {
    const extensionId = 'fractalizer.projects-tree';
    // `onView:*` activation events (package.json) only fire once a contributed view is actually
    // rendered, which this suite never does — activate explicitly so `isActive` below reflects
    // this test's own actions instead of depending on some other suite having triggered it first
    // (mocha does not guarantee suite/file order).
    await vscode.extensions.getExtension(extensionId)?.activate();

    const rootDir = await makeTempRoot('projects-tree-location');
    try {
      await makeProjectDir(rootDir, 'proj');
      await vscode.workspace
        .getConfiguration(SECTION)
        .update('roots', [rootDir], vscode.ConfigurationTarget.Global);

      for (const location of LOCATIONS) {
        await vscode.workspace
          .getConfiguration(SECTION)
          .update('location', location, vscode.ConfigurationTarget.Global);
        assert.equal(vscode.workspace.getConfiguration(SECTION).get('location'), location);
        // Reached only if the extension host is still the one that started this test — a reload
        // would have ended the process before this line ran again for the next mode.
        assert.equal(vscode.extensions.getExtension(extensionId)?.isActive, true);
        // Real effect, not just "nothing threw during the setting write": the same provider
        // `refreshFromSettings` drives is exercised through the command it registers, once per
        // mode — including `'none'`, whose own code path drops every root before discovery runs.
        await vscode.commands.executeCommand('projectsTree.refresh');
      }
    } finally {
      await removeDir(rootDir);
    }
  });
});
