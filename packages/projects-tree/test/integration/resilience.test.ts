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
import { makeTempRoot, removeDir } from './temp-tree.js';

suite('deleting a folder from disk while the tree is expanded', () => {
  let rootDir: string;

  setup(async () => {
    rootDir = await makeTempRoot('projects-tree-resilience');
  });

  teardown(async () => {
    await removeDir(rootDir);
  });

  test('a re-discovered branch that vanished from disk raises no exception', async () => {
    const branchDir = path.join(rootDir, 'branch');
    await mkdir(branchDir, { recursive: true });
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

    // Populate the tree while `branch` still exists — mirroring a node that is currently expanded
    // in a real tree view — before it disappears out from under the walk.
    await provider.refresh();
    assert.equal(provider.getChildren().length, 1);

    await removeDir(branchDir);
    await assert.doesNotReject(provider.refresh());
    assert.equal(provider.getChildren().length, 0);

    provider.dispose();
  });

  test('a root that vanished entirely raises no exception', async () => {
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

    await provider.refresh();
    await removeDir(rootDir);
    await assert.doesNotReject(provider.refresh());

    provider.dispose();
  });
});
