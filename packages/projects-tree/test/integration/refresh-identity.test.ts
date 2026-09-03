/**
 * Test-insurance for the identity contract `NodeRegistry` exists to uphold
 * (src/editor/tree-view/registry.ts, docs/plans/projects-tree/03-tree-view.md package 03-A):
 * `ExtHostTreeView` addresses tree items by object identity (api-facts.md, fact 4), so a `refresh`
 * that hands the platform a freshly created object for a key it already knows about is a silent
 * no-op. To go red here without an editor, break `NodeRegistry.canonicalize` — for example, make
 * it return `{ ...node, children }` unconditionally instead of looking `key` up in `#canonical`
 * first (i.e. treat every node as new). This suite would then fail at the `sameProject === true`
 * assertion below.
 */
import * as assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_RULES } from '../../src/projects/classification/index.js';
import { createNodeFileSystemReader } from '../../src/projects/discovery/index.js';
import {
  NodeRegistry,
  ProjectsTreeProvider,
  RootGroupRegistry,
} from '../../src/editor/tree-view/index.js';
import type { ConfiguredRoot } from '../../src/editor/configuration/index.js';
import { isRootGroupNode, type TreeElement } from '../../src/editor/tree-view/root-group.js';
import type { ClassifiedNode } from '../../src/projects/discovery/index.js';
import { makeTempRoot, removeDir } from './temp-tree.js';

function findByName(elements: readonly TreeElement[], name: string): ClassifiedNode {
  const found = elements.find(
    (element): element is ClassifiedNode =>
      !isRootGroupNode(element) && element.facts.name === name,
  );
  assert.ok(found, `no node named "${name}" in ${JSON.stringify(elements)}`);
  return found;
}

suite('refresh redraws a branch through stable node identity', () => {
  let rootDir: string;

  setup(async () => {
    rootDir = await makeTempRoot('projects-tree-refresh');
  });

  teardown(async () => {
    await removeDir(rootDir);
  });

  test('the same NodeKey keeps its object identity across refresh, content updated in place', async () => {
    // A plain folder, not a project (`DEFAULT_RULES` gives a project `stopDescend: true` and
    // `applyDescendStrategy` (src/projects/discovery/tree.ts) always replaces a project's children
    // with its `descend` strategy's result, independent of what is on disk — an ordinary folder is
    // what actually gets its children re-walked from the filesystem on every refresh).
    const containerDir = path.join(rootDir, 'container');
    await mkdir(containerDir, { recursive: true });
    const root: ConfiguredRoot = { id: 'r1', path: rootDir };
    const provider = new ProjectsTreeProvider(
      () => [root],
      () => 'auto',
      createNodeFileSystemReader(),
      DEFAULT_RULES,
      new NodeRegistry(),
      new RootGroupRegistry(),
      // Nothing is remembered as expanded: these suites assert tree content and node identity, not
      // the expansion store (which has its own unit tests). `false` means "no opinion" — item.ts
      // then uses its own per-kind default (api-facts.md, fact 41).
      () => false,
    );

    let redrawCount = 0;
    provider.onDidChangeTreeData(() => {
      redrawCount++;
    });

    await provider.refresh();
    const before = findByName(provider.getChildren(), 'container');
    assert.equal(before.children.length, 0);
    assert.equal(redrawCount, 1);

    // Change the node's underlying data without changing its NodeKey (rootId + pathFromRoot):
    // add a plain subdirectory under the already-discovered folder.
    await mkdir(path.join(containerDir, 'nested'), { recursive: true });
    await provider.refresh();
    const after = findByName(provider.getChildren(), 'container');

    assert.equal(redrawCount, 2, 'refresh must fire onDidChangeTreeData to redraw at all');
    assert.equal(after, before, 'NodeRegistry must hand back the same object for the same NodeKey');
    assert.equal(
      after.children.length,
      1,
      'the canonical object must be updated in place with the new content',
    );

    provider.dispose();
  });
});
