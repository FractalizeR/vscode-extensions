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
import { isRootGroupNode } from '../../src/editor/tree-view/root-group.js';
import type { ClassifiedNode } from '../../src/projects/discovery/index.js';
import { makeProjectDir, makeTempRoot, removeDir } from './temp-tree.js';

suite('getChildren over a real directory tree', () => {
  let rootDir: string;

  setup(async () => {
    rootDir = await makeTempRoot('projects-tree-discovery');
  });

  teardown(async () => {
    await removeDir(rootDir);
  });

  test('classifies real subdirectories and exposes them as tree children', async () => {
    await makeProjectDir(rootDir, 'proj-a');
    await makeProjectDir(rootDir, 'proj-b');
    await mkdir(path.join(rootDir, 'not-a-project'), { recursive: true });

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
    const topLevel = provider.getChildren();

    // A single configured root is not grouped under a synthetic container in `'auto'` mode
    // (src/editor/tree-view/top-level.ts) — every child is a real classified node.
    assert.equal(
      topLevel.some((node) => isRootGroupNode(node)),
      false,
    );
    // `.sort()`, not `.toSorted()`: tsconfig.base.json targets `lib: ["ES2022"]`, which predates
    // `Array#toSorted` (ES2023) — `.map()` above already produced a fresh array, so mutating it in
    // place is not a shared-array hazard.
    const names = topLevel
      .map((node) => (isRootGroupNode(node) ? node.label : node.facts.name))
      // eslint-disable-next-line unicorn/no-array-sort
      .sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, ['not-a-project', 'proj-a', 'proj-b']);

    const projectA = topLevel.find(
      (node): node is ClassifiedNode => !isRootGroupNode(node) && node.facts.name === 'proj-a',
    );
    assert.ok(projectA);
    assert.equal(projectA.verdict.project.value, true);

    provider.dispose();
  });
});
