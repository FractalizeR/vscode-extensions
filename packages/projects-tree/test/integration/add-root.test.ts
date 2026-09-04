/**
 * `projectsTree.addRoot`'s only interactive step is `vscode.window.showOpenDialog` — a native
 * folder picker a headless test host cannot drive (no automated way to select a folder in it).
 * What this suite checks instead is what actually *is* production-path-testable: the write the
 * command performs once a folder is picked (`mergeRoots` producing the raw setting entries,
 * `ConfigurationTarget.Global`) and the read every consumer relies on afterward (`readRoots`).
 * Both are called here directly, not through `projectsTree.addRoot` itself — this test is
 * therefore weaker than its suite name might suggest: it proves the setting write/read
 * round-trip the real command depends on, not that the command wires `showOpenDialog`'s result
 * into `mergeRoots` correctly (that wiring has no seam to substitute the dialog through, and is
 * the manual check `04-actions.md`'s test plan already defers to a live machine).
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { mergeRoots } from '../../src/editor/configuration/merge-roots.js';
import { readRoots, type ConfiguredRoot } from '../../src/editor/configuration/index.js';

const SECTION = 'projectsTree';

suite('"Add Root" writes a path projectsTree.roots reads back correctly', () => {
  let originalRoots: unknown;

  setup(() => {
    originalRoots = vscode.workspace.getConfiguration(SECTION).get('roots');
  });

  teardown(async () => {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', originalRoots, vscode.ConfigurationTarget.Global);
  });

  test('a path with a space and a path with a trailing separator both round-trip', async () => {
    const withSpace = '/tmp/projects tree add root/has space';
    const withTrailingSeparator = '/tmp/projects-tree-add-root/trailing/';

    const { roots: existing } = readRoots();
    const merged = mergeRoots(existing, [withSpace, withTrailingSeparator]);
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', merged, vscode.ConfigurationTarget.Global);

    const { roots, invalid, duplicates } = readRoots();
    assert.deepEqual(invalid, []);
    assert.deepEqual(duplicates, []);

    const byPath = new Map<string, ConfiguredRoot>(roots.map((root) => [root.path, root]));
    assert.ok(byPath.has(withSpace), 'the path with a space must survive the round-trip verbatim');
    // `readRoots`' `normalizeRootPath` strips a trailing separator so the id (and therefore
    // `NodeKey`) is stable regardless of how the path was typed or picked — the trailing form
    // itself must not appear in the read-back result.
    assert.ok(
      byPath.has(withTrailingSeparator.replace(/\/+$/, '')),
      'the trailing separator must be normalized away on read-back',
    );
    assert.ok(
      !byPath.has(withTrailingSeparator),
      'the raw trailing-separator form must not survive',
    );
  });
});
