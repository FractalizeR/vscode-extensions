/**
 * R07-REFRESH: the real `projectsTree.refresh` command used to call only
 * `ProjectsTreeProvider.refresh()`, never re-reading `projects-tree.rules.json` — a manual edit to
 * the file (the workflow README.md:20 and `00-overview.md` promise "picked up on the next refresh")
 * was invisible until the window was reloaded. `refresh.test.ts` (a vitest unit test) covers that
 * the command now calls the given reload pipeline; this suite is the end-to-end proof that the real
 * wiring in `extension.ts` actually re-reads the file a hand edit lands in.
 *
 * The real extension keeps `rules`/`provider`/`ProjectListCache` private (`activation.test.ts`'s own
 * doc comment), so there is no direct accessor to assert against. `projectsTree.openProject`'s
 * QuickPick offering is used as the observable proxy instead: it is built from the same module-level
 * `rules` variable `refreshFromSettings` reassigns, so a rules-file edit becoming visible in that
 * offering after `projectsTree.refresh` is exactly the effect the missing reload broke.
 */
import * as assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import * as vscode from 'vscode';
import { RULES_FILE_NAME } from '../../src/editor/rules/canonical-rules.js';
import { makeProjectDir, makeTempRoot, removeDir } from './temp-tree.js';

const EXTENSION_ID = 'fractalizer.projects-tree';
const SECTION = 'projectsTree';

interface QuickPickItemLike {
  readonly label: string;
}

async function globalStorageRulesFilePath(): Promise<string> {
  // Same derivation as `hide.test.ts`'s own helper — see that file's doc comment for why
  // `--user-data-dir` is the only obtainable handle on an extension's global storage path from
  // outside `activate()` at this API floor (1.85.0).
  const configUrl = nodePath.join(process.cwd(), '.vscode-test.mjs');
  const config = (await import(configUrl)) as {
    default: { launchArgs?: readonly string[] };
  };
  const launchArgs = config.default.launchArgs ?? [];
  const flagIndex = launchArgs.indexOf('--user-data-dir');
  const userDataDir = flagIndex === -1 ? undefined : launchArgs[flagIndex + 1];
  assert.ok(userDataDir, '.vscode-test.mjs no longer passes --user-data-dir');
  return nodePath.join(userDataDir, 'User', 'globalStorage', EXTENSION_ID, RULES_FILE_NAME);
}

/**
 * Runs `projectsTree.openProject`, stubbing `showQuickPick` to capture the offered items and
 * dismiss the picker (returning `undefined`) rather than opening anything.
 */
async function offeredProjectLabels(): Promise<readonly string[]> {
  const original = vscode.window.showQuickPick;
  let offered: readonly QuickPickItemLike[] = [];
  vscode.window.showQuickPick = ((items: readonly QuickPickItemLike[]) => {
    offered = items;
    return Promise.resolve(undefined);
  }) as unknown as typeof vscode.window.showQuickPick;
  try {
    await vscode.commands.executeCommand('projectsTree.openProject');
  } finally {
    vscode.window.showQuickPick = original;
  }
  return offered.map((item) => item.label);
}

suite('"Refresh" re-reads the rules file, not only the tree', () => {
  let rootDir: string;
  let rulesFile: string;
  let originalRulesFileContent: string | undefined;
  let originalRoots: unknown;

  setup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    rootDir = await makeTempRoot('projects-tree-refresh-rules');
    await makeProjectDir(rootDir, 'hide-me');
    await makeProjectDir(rootDir, 'keep-me');

    rulesFile = await globalStorageRulesFilePath();
    try {
      originalRulesFileContent = await readFile(rulesFile, 'utf8');
    } catch {
      originalRulesFileContent = undefined;
    }

    originalRoots = vscode.workspace.getConfiguration(SECTION).get('roots');
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', [rootDir], vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('projectsTree.refresh');
  });

  teardown(async () => {
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', originalRoots, vscode.ConfigurationTarget.Global);
    if (originalRulesFileContent === undefined) {
      await rm(rulesFile, { force: true });
    } else {
      await writeFile(rulesFile, originalRulesFileContent, 'utf8');
    }
    await vscode.commands.executeCommand('projectsTree.refresh');
    await removeDir(rootDir);
  });

  test('a hand-edited rules file changes the next Refresh, without a window reload', async () => {
    const before = await offeredProjectLabels();
    assert.ok(before.includes('hide-me'), `expected hide-me in ${String(before)}`);
    assert.ok(before.includes('keep-me'), `expected keep-me in ${String(before)}`);

    // Written directly to disk, bypassing every extension-owned writer ("Hide", the rules editor):
    // exactly the "edit the file by hand" path README.md:20 and 00-overview.md's "Хранение
    // правил" describe as picked up "on the next refresh".
    const handEdited = {
      version: 1,
      rules: [
        {
          id: 'hand-edited-hide',
          when: { kind: 'nameMatches', pattern: '^hide-me$' },
          // On-disk key is `then`, not `verdict` — `RawRule` (`classification/rules-file.ts`)
          // renames it because an object with a `then` property is a thenable.
          // eslint-disable-next-line unicorn/no-thenable -- on-disk key, see rules-file.ts.
          then: { skip: true },
        },
      ],
      actions: [],
    };
    // Unlike the real writer (`store.ts`'s `writeRulesFile`), a hand edit cannot assume the
    // directory exists: on a clean profile nothing has created `globalStorage/<extension-id>/` yet
    // (`setup`'s own `projectsTree.refresh` only reads the rules file, never writes it), so this
    // test — standing in for a human editor — creates the directory itself, mirroring
    // `mkdir(dir, { recursive: true })` in `store.ts`.
    await mkdir(nodePath.dirname(rulesFile), { recursive: true });
    await writeFile(rulesFile, JSON.stringify(handEdited, null, 2), 'utf8');

    await vscode.commands.executeCommand('projectsTree.refresh');

    const after = await offeredProjectLabels();
    assert.ok(
      !after.includes('hide-me'),
      `hide-me must be gone after Refresh, got ${String(after)}`,
    );
    assert.ok(after.includes('keep-me'), `keep-me must be unaffected, got ${String(after)}`);
  });
});
