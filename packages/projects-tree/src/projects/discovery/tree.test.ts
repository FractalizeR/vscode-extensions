import { describe, expect, it } from 'vitest';
import type { Rule } from '../classification/index.js';
import { CancellationSource } from './cancellation.js';
import { FileSystemError, type FileSystemReader } from './file-system.js';
import { discoverProjectTree, type ClassifiedNode } from './tree.js';

/**
 * A genuine directory-tree model, not a set of canned answers keyed by call — `readDirectory`
 * looks a path up in `nodes` and lists whatever is actually there, so a bug in the walker (wrong
 * path built, wrong entries returned, a read that should not have happened) shows up as a wrong
 * answer rather than being invisible to a mock that already knows what the test expects.
 *
 * Every read is counted (`readDirectoryCalls`, `pathsRead`, `peakActiveReads`) — the "skip by name
 * does not read" and "cancellation stops reading" invariants in the tests below are asserted on
 * these counters, per the package's DoD, not on what the walker claims to have done.
 */
type FakeNode =
  | {
      readonly type: 'dir';
      readonly children: Readonly<Record<string, FakeNode>>;
      readonly denyRead?: boolean;
    }
  | { readonly type: 'file' }
  | { readonly type: 'symlink'; readonly target: string };

type ResolvedNode = Exclude<FakeNode, { readonly type: 'symlink' }>;

function toSegments(path: string): string[] {
  const segments: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments;
}

class FakeFileSystem implements FileSystemReader {
  #nextId = 1;
  readonly #ids = new WeakMap<FakeNode, string>();

  readonly pathsRead: string[] = [];
  activeReads = 0;
  peakActiveReads = 0;

  constructor(
    private readonly root: FakeNode,
    private readonly hooks: {
      beforeRead?: (path: string, readsSoFar: number) => void;
      onRead?: (path: string) => void;
    } = {},
  ) {}

  #resolve(path: string): FakeNode | undefined {
    let current: FakeNode = this.root;
    for (const segment of toSegments(path)) {
      if (current.type !== 'dir') return undefined;
      const next: FakeNode | undefined = current.children[segment];
      if (!next) return undefined;
      current = next;
    }
    return current;
  }

  #resolveFollowingSymlinks(path: string, hops = 0): ResolvedNode | undefined {
    if (hops > 20) return undefined; // guards a symlink chain in the fixture data itself, not the walk
    const node = this.#resolve(path);
    if (!node) return undefined;
    if (node.type === 'symlink') {
      return this.#resolveFollowingSymlinks(this.#resolveSymlinkPath(path, node), hops + 1);
    }
    return node;
  }

  #resolveSymlinkPath(path: string, node: { target: string }): string {
    const dir = path.slice(0, path.lastIndexOf('/'));
    return node.target.startsWith('/') ? node.target : `${dir}/${node.target}`;
  }

  #symlinkTargetOf(parentPath: string, name: string, symlink: { type: 'symlink'; target: string }) {
    const targetPath = this.#resolveSymlinkPath(`${parentPath}/${name}`, symlink);
    const targetNode = this.#resolveFollowingSymlinks(targetPath);
    if (!targetNode) return { type: 'broken' as const };
    return { type: targetNode.type, deviceAndInode: this.#idOf(targetNode) };
  }

  #idOf(node: FakeNode): string {
    let id = this.#ids.get(node);
    if (id === undefined) {
      id = `id-${String(this.#nextId)}`;
      this.#nextId += 1;
      this.#ids.set(node, id);
    }
    return id;
  }

  #listEntries(parentPath: string, children: Readonly<Record<string, FakeNode>>) {
    const entries = [];
    for (const [name, child] of Object.entries(children)) {
      const symlinkTarget =
        child.type === 'symlink' && this.#symlinkTargetOf(parentPath, name, child);
      entries.push({ name, type: child.type, ...(symlinkTarget && { symlinkTarget }) });
    }
    return entries;
  }

  get readDirectoryCalls(): number {
    return this.pathsRead.length;
  }

  async readDirectory(path: string) {
    this.hooks.beforeRead?.(path, this.pathsRead.length);
    this.pathsRead.push(path);
    this.activeReads += 1;
    this.peakActiveReads = Math.max(this.peakActiveReads, this.activeReads);
    try {
      // A microtask boundary so concurrent reads genuinely overlap in the "hundreds of
      // projects" test instead of one finishing before the pool ever admits a second.
      await Promise.resolve();
      this.hooks.onRead?.(path);
      const node = this.#resolveFollowingSymlinks(path);
      if (!node) {
        throw new FileSystemError('notFound', `no such file or directory: ${path}`);
      }
      if (node.type === 'file') {
        throw new FileSystemError('notDirectory', `not a directory: ${path}`);
      }
      if (node.denyRead) {
        throw new FileSystemError('permissionDenied', `permission denied: ${path}`);
      }
      return this.#listEntries(path, node.children);
    } finally {
      this.activeReads -= 1;
    }
  }

  readFile(): Promise<string> {
    return Promise.reject(new Error('not used by these tests'));
  }

  async identity(path: string): Promise<string> {
    await Promise.resolve();
    const node = this.#resolveFollowingSymlinks(path);
    if (!node || (node.type === 'dir' && node.denyRead)) {
      throw new FileSystemError('notFound', `no such file or directory: ${path}`);
    }
    return this.#idOf(node);
  }

  /**
  Simulates "the folder was removed between listing and opening": drops a node from the model.
  */
  deletePath(path: string): void {
    const segments = toSegments(path);
    const name = segments.pop();
    if (name === undefined) return;
    const parent = this.#resolve(segments.join('/'));
    if (parent?.type === 'dir') {
      // `children` is Readonly<Record<...>> for callers; deletePath is the one place in this
      // fixture allowed to mutate it, to model an external actor deleting the directory.
      const { [name]: _removed, ...remaining } = parent.children;
      (parent as { children: Readonly<Record<string, FakeNode>> }).children = remaining;
    }
  }
}

function dir(children: Readonly<Record<string, FakeNode>> = {}, shouldDenyRead = false): FakeNode {
  return shouldDenyRead
    ? { type: 'dir', children, denyRead: shouldDenyRead }
    : { type: 'dir', children };
}
function file(): FakeNode {
  return { type: 'file' };
}
function symlink(target: string): FakeNode {
  return { type: 'symlink', target };
}

function nameRule(id: string, pattern: string, shouldSkip: boolean): Rule {
  return { id, when: { kind: 'nameMatches', pattern }, verdict: { skip: shouldSkip } };
}

function projectByGitRule(id = 'is-project'): Rule {
  return { id, when: { kind: 'hasChild', names: ['.git'] }, verdict: { project: true } };
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

function flatten(nodes: readonly ClassifiedNode[]): ClassifiedNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe('discoverProjectTree — traversal of a test tree', () => {
  it('produces the expected set of nodes, honoring skip and stopDescend', async () => {
    const projectSrc = dir({ 'main.ts': file() });
    const projectA = dir({ '.git': dir(), src: projectSrc });
    const nodeModulesPkg = dir({ 'index.js': file() });
    const nodeModules = dir({ 'some-pkg': nodeModulesPkg });
    const docs = dir({ 'readme.md': file() });
    const testRoot = dir({ 'project-a': projectA, node_modules: nodeModules, docs });
    const fs = new FakeFileSystem(testRoot);
    const rules: Rule[] = [
      projectByGitRule(),
      nameRule('skip-node-modules', '^node_modules$', true),
    ];

    const result = await discoverProjectTree(
      [{ id: 'root-1', path: '' }],
      rules,
      fs,
      new CancellationSource().signal,
    );

    expect(result.diagnostics).toEqual([]);
    const paths = flatten(result.nodes).map((node) => node.facts.pathFromRoot);
    expect(paths).toEqual(
      expect.arrayContaining(['project-a', 'project-a/.git', 'project-a/src', 'docs']),
    );
    expect(paths).not.toContain('node_modules');
    expect(paths).not.toContain('node_modules/some-pkg');

    const projectANode = findByPath(result.nodes, 'project-a');
    expect(projectANode?.verdict.project).toEqual({ value: true, byRule: 'is-project' });
  });

  it('a skip rule matched purely by name never reads the skipped directory’s contents', async () => {
    /**
     * The plan requires this to be a machine-checkable invariant: a `hasChild`-free skip rule
     * resolves from name/depth alone, so the walker must never call readDirectory on
     * `node_modules` — the two directories under it are traps that would show up read if it did.
     */
    const nodeModules = dir({ 'trap-a': dir(), 'trap-b': dir() });
    const testRoot = dir({ node_modules: nodeModules, docs: dir() });
    const fs = new FakeFileSystem(testRoot);
    const rules: Rule[] = [nameRule('skip-node-modules', '^node_modules$', true)];

    await discoverProjectTree([{ id: 'r', path: '' }], rules, fs, new CancellationSource().signal);

    expect(fs.pathsRead).not.toContain('/node_modules');
    expect(fs.pathsRead.some((path) => path.startsWith('/node_modules/'))).toBe(false);
  });

  it('does read a directory’s own content when a hasChild rule needs it to classify it', async () => {
    // Counterpart to the previous test: a project-detecting rule genuinely needs entries, so the
    // read must happen — the optimization only skips reads that are provably unnecessary.
    const projectA = dir({ '.git': dir() });
    const testRoot = dir({ 'project-a': projectA });
    const fs = new FakeFileSystem(testRoot);
    const rules: Rule[] = [projectByGitRule()];

    await discoverProjectTree([{ id: 'r', path: '' }], rules, fs, new CancellationSource().signal);

    expect(fs.pathsRead).toContain('/project-a');
  });
});

describe('discoverProjectTree — root diagnostics', () => {
  it('reports a diagnostic, not a throw, for a root that does not exist', async () => {
    const fs = new FakeFileSystem(dir());

    const result = await discoverProjectTree(
      [{ id: 'missing', path: '/does-not-exist' }],
      [],
      fs,
      new CancellationSource().signal,
    );

    expect(result.nodes).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      rootId: 'missing',
      path: '/does-not-exist',
      kind: 'notFound',
    });
    expect(typeof result.diagnostics[0]?.message).toBe('string');
  });

  it('reports notDirectory for a root that is a file', async () => {
    const testRoot = dir({ 'a-file': file() });
    const fs = new FakeFileSystem(testRoot);

    const result = await discoverProjectTree(
      [{ id: 'file-root', path: '/a-file' }],
      [],
      fs,
      new CancellationSource().signal,
    );

    expect(result.nodes).toEqual([]);
    expect(result.diagnostics[0]?.kind).toBe('notDirectory');
  });

  it('reports permissionDenied for a root without read access', async () => {
    const lockedRoot = dir({}, /* shouldDenyRead */ true);
    const fs = new FakeFileSystem(lockedRoot);

    const result = await discoverProjectTree(
      [{ id: 'locked', path: '' }],
      [],
      fs,
      new CancellationSource().signal,
    );

    expect(result.nodes).toEqual([]);
    expect(result.diagnostics[0]?.kind).toBe('permissionDenied');
  });
});

describe('discoverProjectTree — symlinks', () => {
  it('does not descend into a symlinked directory by default', async () => {
    const real = dir({ 'x.txt': file() });
    const testRoot = dir({ real, link: symlink('real') });
    const fs = new FakeFileSystem(testRoot);

    const result = await discoverProjectTree(
      [{ id: 'r', path: '' }],
      [],
      fs,
      new CancellationSource().signal,
    );

    const paths = flatten(result.nodes).map((node) => node.facts.pathFromRoot);
    expect(paths).toContain('real');
    expect(paths).not.toContain('link');
  });

  it('follows a symlinked directory when enabled, and terminates on a cycle back to an ancestor', async () => {
    /**
     * A cyclic symlink must terminate the walk, not hang it. `dir-a/loop` points back at the
     * root, which was reached by an ordinary (non-symlink) path — the walker's visited set must
     * therefore record every directory it reads, not only ones reached through a symlink.
     */
    const dirA = dir({ loop: symlink('../..') });
    const testRoot = dir({ 'dir-a': dirA });
    const fs = new FakeFileSystem(testRoot);

    const result = await discoverProjectTree(
      [{ id: 'r', path: '' }],
      [],
      fs,
      new CancellationSource().signal,
      { followSymlinks: true, maxDepth: 10 },
    );

    expect(result.diagnostics.some((d) => d.kind === 'cyclicSymlink')).toBe(true);
    const paths = flatten(result.nodes).map((node) => node.facts.pathFromRoot);
    expect(paths).not.toContain('dir-a/loop/dir-a');
  });

  it('does not crash on a broken symlink and does not add it as a child', async () => {
    const testRoot = dir({ broken: symlink('nowhere') });
    const fs = new FakeFileSystem(testRoot);

    const result = await discoverProjectTree(
      [{ id: 'r', path: '' }],
      [],
      fs,
      new CancellationSource().signal,
      { followSymlinks: true },
    );

    const paths = flatten(result.nodes).map((node) => node.facts.pathFromRoot);
    expect(paths).not.toContain('broken');
  });
});

describe('discoverProjectTree — resilience', () => {
  it('keeps an already-classified node but drops its children when its folder vanishes mid-walk', async () => {
    const willVanish = dir({ 'child.txt': file() });
    const testRoot = dir({ 'will-vanish': willVanish, stays: dir() });
    const fs = new FakeFileSystem(testRoot, {
      onRead(path) {
        if (path === '/will-vanish') {
          fs.deletePath('will-vanish');
        }
      },
    });

    const result = await discoverProjectTree(
      [{ id: 'r', path: '' }],
      [],
      fs,
      new CancellationSource().signal,
    );

    const vanished = findByPath(result.nodes, 'will-vanish');
    expect(vanished).toBeDefined();
    expect(vanished?.children).toEqual([]);
    expect(result.diagnostics.some((d) => d.path === '/will-vanish')).toBe(true);
  });

  it('gives overlapping roots distinct, non-colliding nodes keyed by rootId', async () => {
    const nested = dir({ 'x.txt': file() });
    const testRoot = dir({ nested });
    const fs = new FakeFileSystem(testRoot);

    const result = await discoverProjectTree(
      [
        { id: 'outer', path: '' },
        { id: 'inner', path: '/nested' },
      ],
      [],
      fs,
      new CancellationSource().signal,
    );

    expect(result.nodes).toHaveLength(2);
    const outer = result.nodes.find((node) => node.facts.rootId === 'outer');
    const inner = result.nodes.find((node) => node.facts.rootId === 'inner');
    expect(outer?.facts.pathFromRoot).toBe('');
    expect(inner?.facts.pathFromRoot).toBe('');
    expect(outer?.facts.rootId).not.toBe(inner?.facts.rootId);
    const outerNodes = outer ? [outer] : [];
    const nestedUnderOuter = findByPath(outerNodes, 'nested');
    expect(nestedUnderOuter?.facts.rootId).toBe('outer');
  });

  it('handles hundreds of sibling directories without the concurrency pool degrading', async () => {
    const CHILD_COUNT = 300;
    const CONCURRENCY = 5;
    const children: Record<string, FakeNode> = {};
    for (let index = 0; index < CHILD_COUNT; index += 1) {
      children[`p${String(index)}`] = dir();
    }
    const testRoot = dir(children);
    const fs = new FakeFileSystem(testRoot);

    const result = await discoverProjectTree(
      [{ id: 'r', path: '' }],
      [],
      fs,
      new CancellationSource().signal,
      // maxDepth 2 so each of the 300 children is itself read (to discover its — empty —
      // children), which is what actually exercises the concurrency pool below.
      { maxDepth: 2, concurrency: CONCURRENCY },
    );

    expect(result.nodes[0]?.children).toHaveLength(CHILD_COUNT);
    expect(fs.peakActiveReads).toBeLessThanOrEqual(CONCURRENCY);
    expect(fs.peakActiveReads).toBeGreaterThan(1); // proves reads actually overlapped, not serialized
  });
});

describe('discoverProjectTree — cancellation', () => {
  it('stops reading further directories once cancelled mid-traversal', async () => {
    // A straight-line tree (one child per level) with concurrency 1 keeps read order
    // deterministic: cancelling during the 2nd read must prevent a 3rd from ever starting.
    const source = new CancellationSource();
    const straightC = dir();
    const straightB = dir({ c: straightC });
    const straightA = dir({ b: straightB });
    const testRoot = dir({ a: straightA });
    const fs = new FakeFileSystem(testRoot, {
      beforeRead: (_path, readsSoFar) => {
        if (readsSoFar === 1) source.cancel();
      },
    });

    const options = { concurrency: 1, maxDepth: 10 };
    await expect(
      discoverProjectTree([{ id: 'r', path: '' }], [], fs, source.signal, options),
    ).rejects.toThrow('cancelled');

    expect(fs.readDirectoryCalls).toBe(2);
  });
});
