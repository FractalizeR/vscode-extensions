import { describe, expect, it } from 'vitest';
import type { Rule } from '../classification/index.js';
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
 * A fake `FileSystemReader` for the `submodules` strategy: files (`.gitmodules` in particular) and
 * a set of "existing" paths for `identity`, with every call to every port method counted
 * separately. `readDirectoryCalls` is what the package's central invariant — `submodules` never
 * reads a directory inside the project — is asserted against, not a claim the implementation makes
 * about itself.
 */
class FakeSubmoduleFileSystem implements FileSystemReader {
  readDirectoryCalls = 0;
  readFilePaths: string[] = [];
  identityPaths: string[] = [];

  constructor(
    private readonly files: ReadonlyMap<string, string>,
    private readonly existingPaths: ReadonlySet<string>,
  ) {}

  readDirectory(): Promise<never> {
    this.readDirectoryCalls += 1;
    return Promise.reject(
      new FileSystemError('other', 'submodules strategy must never list a directory'),
    );
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

  async identity(path: string): Promise<string> {
    this.identityPaths.push(path);
    await Promise.resolve();
    if (!this.existingPaths.has(path)) {
      throw new FileSystemError('notFound', `no such file or directory: ${path}`);
    }
    return `id:${path}`;
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
    expect(fs.identityPaths).toEqual([]);
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
      new Set(), // /repo/vendor/foo does not exist
    );
    const node = projectNode();

    const result = await childrenOfProject(node, 'submodules', context(fs));

    expect(result).toEqual({ children: [], diagnostics: [] });
    expect(fs.identityPaths).toEqual(['/repo/vendor/foo']);
  });

  it('a multi-segment path creates intermediate directory nodes', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "foo"]\npath = libs/vendor/foo']]),
      new Set(['/repo/libs/vendor/foo']),
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
  });

  it('a path escaping the project ("../x") is rejected with a diagnostic', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "evil"]\npath = ../x']]),
      new Set(['/repo/../x']),
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
    expect(fs.identityPaths).toEqual([]);
  });

  it("a nested submodule (declared inside a submodule's own .gitmodules) applies the same strategy recursively", async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([
        ['/repo/.gitmodules', '[submodule "foo"]\npath = foo'],
        ['/repo/foo/.gitmodules', '[submodule "bar"]\npath = bar'],
      ]),
      new Set(['/repo/foo', '/repo/foo/bar']),
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
      new Set(['/repo/foo', '/repo/foo/bar']),
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
      new Set(['/repo/vendor']),
    );
    const node = projectNode();
    const rules: Rule[] = [skipRule('skip-vendor', '^vendor$')];

    const result = await childrenOfProject(node, 'submodules', context(fs, { rules }));

    expect(result.children).toEqual([]);
  });

  it('never calls readDirectory for anything under the project', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([
        ['/repo/.gitmodules', '[submodule "a"]\npath = libs/a\n[submodule "b"]\npath = libs/b'],
      ]),
      new Set(['/repo/libs/a', '/repo/libs/b']),
    );
    const node = projectNode();

    await childrenOfProject(node, 'submodules', context(fs));

    expect(fs.readDirectoryCalls).toBe(0);
  });

  it('reads no directories at all — only .gitmodules files, per the DoD counter', async () => {
    const fs = new FakeSubmoduleFileSystem(
      new Map([['/repo/.gitmodules', '[submodule "a"]\npath = a']]),
      new Set(['/repo/a']),
    );
    const node = projectNode();

    await childrenOfProject(node, 'submodules', context(fs));

    // "a" is itself a submodule leaf, so its own (absent) .gitmodules is also read — every file
    // read is a .gitmodules, never a directory listing.
    expect(fs.readFilePaths).toEqual(['/repo/.gitmodules', '/repo/a/.gitmodules']);
    expect(fs.readDirectoryCalls).toBe(0);
  });
});
