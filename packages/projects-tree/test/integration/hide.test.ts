/**
 * The one integration test in this suite that exercises 04-E's whole "Hide" surface end to end:
 * the real registered `projectsTree.hide` command, writing through the real
 * `editor/rules/store.ts` writer, into the real file the real `projectsTree.hide` command
 * targets — not a caller-supplied `RulesFileLocation` the way `hidden.test.ts`'s vitest suite
 * substitutes one (that suite fakes `vscode` entirely and cannot open a real editor at all). The
 * tree side is a `ProjectsTreeProvider` this test builds itself, exactly the pattern
 * `discovery.test.ts`/`refresh-identity.test.ts` already use to observe tree content: the real
 * extension keeps its own provider private (see `activation.test.ts`'s doc comment), so nothing
 * outside `extension.ts` can read it back. Feeding this provider's rules from the same on-disk
 * file the real command writes closes the loop this suite is named for: command -> writer ->
 * reread -> classification -> tree.
 *
 * Locating that file: `readRulesFileForEdit`/`writeRulesFile` take a `RulesFileLocation`
 * (`{ globalStorageUri: { fsPath } }`), and in production that value is the real
 * `vscode.ExtensionContext` the platform hands to `activate()` — which this test, running outside
 * `extension.ts`, has no way to obtain. What IS obtainable: `--user-data-dir`, passed to the test
 * editor by `.vscode-test.mjs`'s own `launchArgs` (imported below rather than re-derived, so this
 * file cannot drift from the value the running editor actually uses). Given that directory, the
 * path VS Code assigns an extension's global storage — `<user-data-dir>/User/globalStorage/
 * <extension-id>/` — is not documented in `vscode.d.ts` or api-facts.md; it was confirmed
 * empirically for this floor (1.85.0) by invoking the real `projectsTree.hide` command with a
 * throwaway node and observing where `projects-tree.rules.json` landed on disk. If a future
 * `vscode.d.ts` grows a documented accessor for an extension's own global storage path (there is
 * none at this floor — `ExtensionContext.globalStorageUri` is only handed to the extension itself,
 * never readable from outside it), prefer that over this path convention.
 */
import * as assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import * as vscode from 'vscode';
import { createNodeFileSystemReader } from '../../src/projects/discovery/index.js';
import type { ClassifiedNode } from '../../src/projects/discovery/index.js';
import {
  loadCanonicalRules,
  readRulesFileForEdit,
  type RulesFileLocation,
} from '../../src/editor/rules/index.js';
import { RULES_FILE_NAME } from '../../src/editor/rules/canonical-rules.js';
import {
  NodeRegistry,
  ProjectsTreeProvider,
  RootGroupRegistry,
} from '../../src/editor/tree-view/index.js';
import type { ConfiguredRoot } from '../../src/editor/configuration/index.js';
import type { ExpansionState } from '../../src/editor/tree-view/expansion.js';
import { isRootGroupNode, type TreeElement } from '../../src/editor/tree-view/root-group.js';
import { makeTempRoot, removeDir } from './temp-tree.js';

const EXTENSION_ID = 'fractalizer.projects-tree';
const SECTION = 'projectsTree';

function findByName(elements: readonly TreeElement[], name: string): ClassifiedNode | undefined {
  return elements.find(
    (element): element is ClassifiedNode =>
      !isRootGroupNode(element) && element.facts.name === name,
  );
}

async function globalStorageRulesFilePath(): Promise<string> {
  // `process.cwd()`, not `__dirname`: `.vscode-test.mjs`'s own comment on `files` states that
  // `vscode-test` resolves its config relative to the current working directory, so
  // `test:integration` (`package.json`) always runs with `packages/projects-tree` as cwd — the
  // same invariant that config file's own resolution already depends on.
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

suite('"Hide" changes the rules file and the tree, and "Manage Hidden" reverses it', () => {
  let rootDir: string;
  let rulesFile: string;
  let originalRulesFileContent: string | undefined;
  let originalRoots: unknown;
  let originalShowQuickPick: typeof vscode.window.showQuickPick;

  setup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    rootDir = await makeTempRoot('projects-tree-hide');
    await mkdir(nodePath.join(rootDir, 'hide-me'), { recursive: true });
    await mkdir(nodePath.join(rootDir, 'keep-me'), { recursive: true });

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

    originalShowQuickPick = vscode.window.showQuickPick;
  });

  teardown(async () => {
    vscode.window.showQuickPick = originalShowQuickPick;
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('roots', originalRoots, vscode.ConfigurationTarget.Global);
    if (originalRulesFileContent === undefined) {
      await rm(rulesFile, { force: true });
    } else {
      await writeFile(rulesFile, originalRulesFileContent, 'utf8');
    }
    await removeDir(rootDir);
  });

  async function buildTree(): Promise<readonly TreeElement[]> {
    const { rules } = await loadCanonicalRules(
      { globalStorageUri: { fsPath: nodePath.dirname(rulesFile) } },
      [],
    );
    const root: ConfiguredRoot = { id: 'r1', path: rootDir };
    const provider = new ProjectsTreeProvider(
      () => [root],
      () => 'auto',
      createNodeFileSystemReader(),
      () => rules,
      new NodeRegistry(),
      new RootGroupRegistry(),
      {
        stateOf: (): ExpansionState | undefined => undefined,
        retainOnly: (): PromiseLike<void> | undefined => undefined,
      },
    );
    await provider.refresh();
    const children = provider.getChildren();
    provider.dispose();
    return children;
  }

  test('hides the node, and Manage Hidden restores it', async () => {
    const before = findByName(await buildTree(), 'hide-me');
    assert.ok(before, 'hide-me must be visible before Hide runs');

    await vscode.commands.executeCommand('projectsTree.hide', before);

    const location: RulesFileLocation = {
      globalStorageUri: { fsPath: nodePath.dirname(rulesFile) },
    };
    const { file } = await readRulesFileForEdit(location, []);
    assert.ok(file, 'the rules file must be readable after Hide wrote to it');
    assert.equal(file.rules.length, 1, 'Hide must write exactly one rule');
    const [hideRule] = file.rules;
    assert.ok(hideRule);
    assert.deepEqual(hideRule.when, {
      kind: 'all',
      of: [
        { kind: 'inRoot', rootId: 'r1' },
        { kind: 'pathEquals', path: 'hide-me' },
      ],
    });
    assert.deepEqual(hideRule.verdict, { skip: true });

    const afterHide = await buildTree();
    assert.equal(findByName(afterHide, 'hide-me'), undefined, 'hide-me must leave the tree');
    assert.ok(findByName(afterHide, 'keep-me'), 'keep-me must be unaffected');

    // `canPickMany: true` (`registerManageHiddenCommand`) awaits a user selection that nothing in
    // a headless test host can click; the picker itself has its own vitest coverage
    // (`hidden.test.ts`) against a faked `vscode`. Stubbing the one call that blocks on UI input —
    // not the security-relevant API this package's own trust gate reads — lets the rest of the
    // command (the real file read, filter and rewrite) run for real.
    vscode.window.showQuickPick = ((items: unknown) =>
      Promise.resolve(items)) as typeof vscode.window.showQuickPick;
    await vscode.commands.executeCommand('projectsTree.manageHidden');

    const { file: afterManage } = await readRulesFileForEdit(location, []);
    assert.equal(afterManage?.rules.length, 0, 'Manage Hidden must remove the rule it restored');

    const afterRestore = await buildTree();
    assert.ok(findByName(afterRestore, 'hide-me'), 'hide-me must be back in the tree');
  });
});
