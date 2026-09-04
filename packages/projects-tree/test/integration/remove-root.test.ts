/**
 * R07-REMOVE-ROOT: the real `projectsTree.removeRoot` command used to require a `RootGroupArg`
 * (the object VS Code passes for a `view/item/context` menu entry on a `rootGroup` node) and show
 * an error otherwise. A `rootGroup` node does not exist at all for a single root under
 * `showRootNodes: "auto"` (the default configuration) — the config this suite reproduces — so the
 * command was unreachable through the UI whenever a workspace had exactly one root, and the
 * Command Palette (which always calls with no argument) hit the same error. Both
 * `showQuickPick`/`showWarningMessage` are stubbed the way `hide.test.ts` and `refresh.test.ts`
 * already stub the one interactive step a headless test host cannot click, letting the rest of the
 * real command (read, fallback QuickPick, confirmation, write) run for real.
 */
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { readRoots } from '../../src/editor/configuration/index.js';
import { makeTempRoot, removeDir } from './temp-tree.js';

const EXTENSION_ID = 'fractalizer.projects-tree';
const SECTION = 'projectsTree';

suite('"Remove Root" is reachable with a single root and no rootGroup node', () => {
  let rootDir: string;
  let originalRoots: unknown;
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;

  setup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    rootDir = await makeTempRoot('projects-tree-remove-root');
    originalRoots = vscode.workspace.getConfiguration(SECTION).get('roots');
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', [rootDir], vscode.ConfigurationTarget.Global);

    originalShowQuickPick = vscode.window.showQuickPick;
    originalShowWarningMessage = vscode.window.showWarningMessage;
  });

  teardown(async () => {
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.window.showWarningMessage = originalShowWarningMessage;
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', originalRoots, vscode.ConfigurationTarget.Global);
    await removeDir(rootDir);
  });

  test('invoking with no argument offers the one configured root and removes it once confirmed', async () => {
    assert.equal(readRoots().roots.length, 1, 'setup must have exactly one root configured');

    let offeredCount: number | undefined;
    vscode.window.showQuickPick = ((items: readonly { rootId?: string }[]) => {
      offeredCount = items.length;
      return Promise.resolve(items.find((item) => item.rootId === rootDir));
    }) as typeof vscode.window.showQuickPick;
    vscode.window.showWarningMessage = (...args: unknown[]): Thenable<string | undefined> => {
      // The last positional argument `registerRemoveRootCommand` passes is the confirm label.
      const confirm = args.at(-1) as string;
      return Promise.resolve(confirm);
    };

    // The command's `when` clause (`viewItem == rootGroup`) never applies here — this call
    // mirrors the Command Palette, which always invokes with no argument at all.
    await vscode.commands.executeCommand('projectsTree.removeRoot');

    assert.equal(offeredCount, 1, 'the QuickPick must offer exactly the one configured root');
    assert.equal(readRoots().roots.length, 0, 'the root must be removed from the setting');
  });
});
