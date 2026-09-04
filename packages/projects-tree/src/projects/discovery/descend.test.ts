import { describe, expect, it } from 'vitest';
import type { DirEntry, Rule } from '../classification/index.js';
import { CancellationSource } from './cancellation.js';
import { FileSystemError, type FileSystemReader } from './file-system.js';
import {
  childrenOfProject,
  type DescendContext,
  type DescendDiagnostic,
  type DescendDiagnosticKind,
} from './descend.js';
import type { ClassifiedNode } from './walker.js';

/**
 * A fake `FileSystemReader` for the `submodules` strategy: files (`.gitmodules` in particular),
 * per-path directory listings, a set of "existing" paths for `realPath`, and an optional override
 * of what a path's `realPath` resolves to (simulating a symlink) — with every call to every port
 * method counted and recorded separately.
 *
 * The package's invariant is **not** "no directory is ever read" (round-05 review, claude-07: that
 * DoD made a submodule unable to ever classify as a project, since `hasChild` cannot resolve
 * against a stub `entries: []`). It is: at most one `readDirectory` call per *declared submodule*,
 * and never for the project itself or a purely structural intermediate node —
 * `readDirectoryPaths` is what the tests below assert that against.
 */
class FakeSubmoduleFileSystem implements FileSystemReader {
  readDirectoryCalls = 0;
  readDirectoryPaths: string[] = [];
  readFilePaths: string[] = [];
  realPathPaths: string[] = [];

  constructor(
    private readonly files: ReadonlyMap<string, string>,
    private readonly existingPaths: ReadonlySet<string>,
    private readonly directories: ReadonlyMap<string, readonly DirEntry[]> = new Map(),
    private readonly realPathOverrides: ReadonlyMap<string, string> = new Map(),
  ) {}

  async readDirectory(path: string): Promise<readonly DirEntry[]> {
    this.readDirectoryCalls += 1;
    this.readDirectoryPaths.push(path);
    await Promise.resolve();
    const entries = this.directories.get(path);
    if (entries === undefined) {
      throw new FileSystemError('notFound', `no such directory: ${path}`);
    }
    return entries;
  }

  async readFile(path: string): Promise<string> {
    this.readFilePaths.push(path);
    await Promise.resolve();
    const content = this.files.get(path);
    if (content === undefined) {
      throw new FileSystemError('notFound', `no such file: ${path}`);
    }
    return content;
  }

  identity(): Promise<never> {
    // The submodules strategy validates existence and containment with `realPath`, not
    // `identity` (round-05 review, codex-05) — a regression back to `identity` would slip past a
    // test that merely never sets `identityPaths` expectations, so this fails loudly instead.
    return Promise.reject(
      new FileSystemError('other', 'the submodules strategy must use realPath, not identity'),
    );
  }

  async realPath(path: string): Promise<string> {
    this.realPathPaths.push(path);
    await Promise.resolve();
    if (!this.existingPaths.has(path)) {
      throw new FileSystemError('notFound', `no such file or directory: ${path}`);
    }
    return this.realPathOverrides.get(path) ?? path;
  }
}

function projectNode(overrides: Partial<ClassifiedNode['facts']> = {}): ClassifiedNode {
  return {
    facts: {
      rootId: 'root-1',
      absolutePath: '/repo',
      pathFromRoot: '',
      name: 'repo',
      depthFromRoot: 0,
      entries: [],
      ...overrides,
    },
    verdict: {
      skip: { value: false, byRule: undefined },
      stopDescend: { value: true, byRule: 'is-project' },
      project: { value: true, byRule: 'is-project' },
      primaryAction: { value: undefined, byRule: undefined },
      highlight: { value: undefined, byRule: undefined },
      tags: { value: [], byRule: undefined },
    },
    children: [],
    entriesRead: true,
  };
}

function context(fs: FileSystemReader, overrides: Partial<DescendContext> = {}): DescendContext {
  return {
    fs,
    rules: [],
    signal: new CancellationSource().signal,
    maxDepth: 4,
    ...overrides,
  };
}

function skipRule(id: string, pattern: string): Rule {
  return { id, when: { kind: 'nameMatches', pattern }, verdict: { skip: true } };
}

function findByPath(
  nodes: readonly ClassifiedNode[],
  pathFromRoot: string,
): ClassifiedNode | undefined {
  for (const node of nodes) {
    if (node.facts.pathFromRoot === pathFromRoot) return node;
    const found = findByPath(node.children, pathFromRoot);
    if (found) return found;
  }
  return undefined;
}

describe('childrenOfProject — "stop" strategy', () => {
  it('gives no children, without touching the filesystem port at all', async () => {
    const fs = new FakeSubmoduleFileSystem(new Map(), new Set());
    const node = projectNode();

    const result = await childrenOfProject(node, 'stop', context(fs));

    expect(result).toEqual({ children: [], diagnostics: [] });
    expect(fs.readDirectoryCalls).toBe(0);
    expect(fs.readFilePaths).toEqual([]);
    expect(fs.realPathPaths).toEqual([]);
  });
});

describe('childrenOfProject — "submodules" strategy, .gitmodules cases from the plan', () => {
  it('no .gitmodules file: the project is a leaf, no diagnostic', async () => {
    const fs = new FakeSubmoduleFileSystem(new Map(), new Set());
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs));

    expect(result).toEqual({ children: [], diagnostics: [] });
    expect(fs.readFilePaths).toEqual(['/repo/.gitmodules']);
  });

  it('a broken .gitmodules gives a diagnostic and leaves the project a leaf', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "a"\npath = a']]), // missing "]"
      new Set(),
    );
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs));
    const diagnostics: readonly DescendDiagnostic[] = result.diagnostics;
    const kind: DescendDiagnosticKind | undefined = diagnostics[0]?.kind;

    expect(result.children).toEqual([]);
    expect(kind).toBe('gitmodulesParseError');
    expect(diagnostics).toEqual([
      {
        rootId: 'root-1',
        path: '/repo/.gitmodules',
        kind: 'gitmodulesParseError',
        message: expect.any(String) as string,
      },
    ]);
  });

  it('an uninitialized submodule (directory missing) is not shown', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "vendor/foo"]\npath = vendor/foo']]),
      new Set(['/repo']), // /repo/vendor/foo does not exist
    );
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs));

    expect(result).toEqual({ children: [], diagnostics: [] });
    expect(fs.realPathPaths).toEqual(['/repo', '/repo/vendor/foo']);
  });

  it('a multi-segment path creates intermediate directory nodes', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "foo"]\npath = libs/vendor/foo']]),
      new Set(['/repo', '/repo/libs/vendor/foo']),
      new Map([['/repo/libs/vendor/foo', []]]),
    );
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs));

    expect(result.diagnostics).toEqual([]);
    const libs = findByPath(result.children, 'libs');
    const vendor = libs && findByPath(libs.children, 'libs/vendor');
    const foo = vendor && findByPath(vendor.children, 'libs/vendor/foo');
    expect(libs?.facts.absolutePath).toBe('/repo/libs');
    expect(vendor?.facts.absolutePath).toBe('/repo/libs/vendor');
    expect(foo?.facts.absolutePath).toBe('/repo/libs/vendor/foo');
    expect(foo?.facts.depthFromRoot).toBe(3);
    // "libs" and "libs/vendor" are structural intermediates, never declared submodules — only the
    // leaf gets a real directory read (round-05 review, claude-07's fix, counter-checked here).
    expect(fs.readDirectoryPaths).toEqual(['/repo/libs/vendor/foo']);
  });

  it('a path escaping the project ("../x") is rejected with a diagnostic', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "evil"]\npath = ../x']]),
      new Set(),
    );
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs));

    expect(result.children).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        rootId: 'root-1',
        path: '/repo/.gitmodules',
        kind: 'gitmodulesPathEscapesProject',
        message: expect.stringContaining('evil') as string,
      },
    ]);
    // The rejected path must never even reach an existence check.
    expect(fs.realPathPaths).toEqual([]);
  });

  it('a path escaping the project through a symlink is rejected with a diagnostic', async () => {
    /**
     * Round-05 review (codex-05): `resolveSegments` only rejects an escape spelled out lexically
     * (`../`, an absolute path). `path = link` is a lexically ordinary single-segment path — the
     * escape only exists on disk, where "link" is a symlink to somewhere outside the project. The
     * fake mimics that by making "/repo/link" a path that exists but whose `realPath` resolves to
     * "/etc", outside "/repo".
     */
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "evil"]\npath = link']]),
      new Set(['/repo', '/repo/link']),
      new Map(),
      new Map([['/repo/link', '/etc']]),
    );
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs));

    expect(result.children).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        rootId: 'root-1',
        path: '/repo/.gitmodules',
        kind: 'gitmodulesPathEscapesProject',
        message: expect.stringContaining('evil') as string,
      },
    ]);
    // The escape is caught before any directory read is attempted for it.
    expect(fs.readDirectoryCalls).toBe(0);
  });

  it("a nested submodule (declared inside a submodule's own .gitmodules) applies the same strategy recursively", async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([
        ['/repo/.gitmodules', '[submodule "foo"]\npath = foo'],
        ['/repo/foo/.gitmodules', '[submodule "bar"]\npath = bar'],
      ]),
      new Set(['/repo', '/repo/foo', '/repo/foo/bar']),
      new Map([
        ['/repo/foo', []],
        ['/repo/foo/bar', []],
      ]),
    );
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs));

    expect(result.diagnostics).toEqual([]);
    const foo = findByPath(result.children, 'foo');
    const bar = foo && findByPath(foo.children, 'foo/bar');
    expect(bar?.facts.absolutePath).toBe('/repo/foo/bar');
    expect(bar?.facts.depthFromRoot).toBe(2);
    // "bar" is itself expanded with the same strategy, so its own (absent) .gitmodules is read too.
    expect(fs.readFilePaths).toEqual([
      '/repo/.gitmodules',
      '/repo/foo/.gitmodules',
      '/repo/foo/bar/.gitmodules',
    ]);
  });

  it('nesting is bounded by maxDepth, independent of stopDescend', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([
        ['/repo/.gitmodules', '[submodule "foo"]\npath = foo'],
        ['/repo/foo/.gitmodules', '[submodule "bar"]\npath = bar'],
      ]),
      new Set(['/repo', '/repo/foo', '/repo/foo/bar']),
      new Map([['/repo/foo', []]]),
    );
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs, { maxDepth: 1 }));

    const foo = findByPath(result.children, 'foo');
    expect(foo).toBeDefined();
    expect(foo?.children).toEqual([]); // depth 1 reached at "foo" — "bar" is not expanded
    expect(fs.readFilePaths).toEqual(['/repo/.gitmodules']); // foo's own .gitmodules is never read
  });

  it('a submodule-derived node is still subject to the rule engine (skip applies)', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "vendor"]\npath = vendor']]),
      new Set(['/repo', '/repo/vendor']),
      new Map([['/repo/vendor', []]]),
    );
    const node = projectNode();
    const rules: Rule[] = [skipRule('skip-vendor', '^vendor$')];

    const result = await childrenOfProject(node, 'submodules', context(fs, { rules }));

    expect(result.children).toEqual([]);
  });

  it('a submodule whose own directory contains .git becomes a project through the ordinary rule engine', async () => {
    /**
     * Round-05 review (claude-07): before this fix, a submodule's classification facts always
     * carried a stub `entries: []`, so `hasChild(['.git'])` could never resolve and a submodule
     * could never be `project: true` no matter what it actually contained on disk. Rules stay the
     * single source of the verdict — this proves the leaf's real listing reaches the classifier.
     */
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "lib"]\npath = lib']]),
      new Set(['/repo', '/repo/lib']),
      new Map([['/repo/lib', [{ name: '.git', type: 'dir' }]]]),
    );
    const node = projectNode();
    const rules: Rule[] = [
      { id: 'is-project', when: { kind: 'hasChild', names: ['.git'] }, verdict: { project: true } },
    ];

    const result = await childrenOfProject(node, 'submodules', context(fs, { rules }));

    expect(result.diagnostics).toEqual([]);
    const lib = findByPath(result.children, 'lib');
    expect(lib?.verdict.project).toEqual({ value: true, byRule: 'is-project' });
  });

  it('reads at most one directory per declared submodule, and never the project or a structural intermediate', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([
        ['/repo/.gitmodules', '[submodule "a"]\npath = libs/a\n[submodule "b"]\npath = libs/b'],
      ]),
      new Set(['/repo', '/repo/libs/a', '/repo/libs/b']),
      new Map([
        ['/repo/libs/a', []],
        ['/repo/libs/b', []],
      ]),
    );
    const node = projectNode();

    await childrenOfProject(node, 'submodules', context(fs));

    // Exactly the two declared submodule leaves — never "/repo" (the project itself) and never
    // "/repo/libs" (a structural intermediate shared by both, not itself a declared submodule).
    expect(new Set(fs.readDirectoryPaths)).toEqual(new Set(['/repo/libs/a', '/repo/libs/b']));
    expect(fs.readDirectoryCalls).toBe(2);
  });

  it('reads a nested submodule’s own .gitmodules, not just its parent’s', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "a"]\npath = a']]),
      new Set(['/repo', '/repo/a']),
      new Map([['/repo/a', []]]),
    );
    const node = projectNode();

    await childrenOfProject(node, 'submodules', context(fs));

    // "a" is itself a submodule leaf, so its own (absent) .gitmodules is also read, in addition to
    // the one real directory read for "a" itself.
    expect(fs.readFilePaths).toEqual(['/repo/.gitmodules', '/repo/a/.gitmodules']);
    expect(fs.readDirectoryPaths).toEqual(['/repo/a']);
  });
});
