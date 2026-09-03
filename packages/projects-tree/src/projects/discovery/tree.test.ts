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
  | { readonly type: 'file'; readonly content?: string }
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

  async readFile(path: string, maxBytes: number): Promise<string> {
    await Promise.resolve();
    const node = this.#resolveFollowingSymlinks(path);
    if (node?.type !== 'file') {
      throw new FileSystemError('notFound', `no such file or directory: ${path}`);
    }
    return (node.content ?? '').slice(0, maxBytes);
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
  Symlink-unaware on purpose: nothing in this file declares a submodule path through a symlink, so
  a plain existence check is enough — the symlink/containment case is covered at the unit level by
  descend.test.ts, against a fake built for exactly that.
  */
  async realPath(path: string): Promise<string> {
    await Promise.resolve();
    const node = this.#resolveFollowingSymlinks(path);
    if (!node) {
      throw new FileSystemError('notFound', `no such file or directory: ${path}`);
    }
    return path === '' ? '/' : path;
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
function file(content?: string): FakeNode {
  return content === undefined ? { type: 'file' } : { type: 'file', content };
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
  it('produces the expected set of nodes, honoring skip', async () => {
    const projectA = dir({ '.git': dir() });
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
    expect(paths).toEqual(expect.arrayContaining(['project-a', 'docs']));
    expect(paths).not.toContain('node_modules');
    expect(paths).not.toContain('node_modules/some-pkg');

    const projectANode = findByPath(result.nodes, 'project-a');
    expect(projectANode?.verdict.project).toEqual({ value: true, byRule: 'is-project' });
  });

  it('a stopDescend rule stops the walk without reading the stopped directory’s own contents', async () => {
    /**
     * Round-05 review (codex-09): the previous version of this test claimed to cover
     * `stopDescend` but never set the field, so the walk it exercised behaved identically with or
     * without it. A rule here sets only `stopDescend` (no `project`), isolating the mechanism
     * `walker.ts` implements from the separate project-descend-strategy override tested below.
     */
    const stopped = dir({ 'nested.txt': file(), 'nested-dir': dir({ trap: dir() }) });
    const testRoot = dir({ 'stop-here': stopped, docs: dir() });
    const fs = new FakeFileSystem(testRoot);
    const rules: Rule[] = [
      {
        id: 'stop-here',
        when: { kind: 'nameMatches', pattern: '^stop-here$' },
        verdict: { stopDescend: true },
      },
    ];

    const result = await discoverProjectTree(
      [{ id: 'r', path: '' }],
      rules,
      fs,
      new CancellationSource().signal,
    );

    const stopHereNode = findByPath(result.nodes, 'stop-here');
    expect(stopHereNode).toBeDefined();
    expect(stopHereNode?.children).toEqual([]);
    expect(fs.pathsRead).not.toContain('/stop-here');
    expect(fs.pathsRead.some((path) => path.startsWith('/stop-here/'))).toBe(false);
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

  it('marks entriesRead false for a node classified from name/depth alone, distinguishing it from a genuinely empty directory', async () => {
    /**
     * Round-05 review (claude-13): a node resolved by `nameMatches`/`depth` never reads its own
     * directory, so `facts.entries` stays `[]` the same way a genuinely empty directory's would.
     * `docs`'s own listing is never read here — "readme.md" would show up read if it were — yet the
     * node must still say, explicitly, that nobody looked.
     */
    const docs = dir({ 'readme.md': file() });
    const empty = dir({});
    const testRoot = dir({ docs, empty });
    const fs = new FakeFileSystem(testRoot);
    const rules: Rule[] = [nameRule('mark-docs', '^docs$', false)];

    const result = await discoverProjectTree(
      [{ id: 'r', path: '' }],
      rules,
      fs,
      new CancellationSource().signal,
      { maxDepth: 1 }, // "docs" is reached and classified, but not itself expanded/read
    );

    const docsNode = findByPath(result.nodes, 'docs');
    expect(docsNode?.entriesRead).toBe(false);
    expect(docsNode?.facts.entries).toEqual([]);
    expect(fs.pathsRead).not.toContain('/docs');
  });
});

describe('discoverProjectTree — project descend strategy', () => {
  /**
   * Round-05 review (codex-03): `descend.ts` was implemented and unit-tested in isolation but
   * never called from `tree.ts` — `childrenOfProject` had no effect on the tree
   * `discoverProjectTree` actually returned. These tests exercise the wiring end to end, not just
   * `childrenOfProject` itself (already covered by descend.test.ts).
   */
  it('a project’s real subdirectories are invisible under the default "stop" strategy', async () => {
    const projectA = dir({ '.git': dir(), src: dir({ 'main.ts': file() }) });
    const testRoot = dir({ 'project-a': projectA });
    const fs = new FakeFileSystem(testRoot);
    const rules: Rule[] = [projectByGitRule()];

    const result = await discoverProjectTree(
      [{ id: 'r', path: '' }], // no `descend` — defaults to 'stop'
      rules,
      fs,
      new CancellationSource().signal,
    );

    const projectANode = findByPath(result.nodes, 'project-a');
    expect(projectANode?.verdict.project.value).toBe(true);
    expect(projectANode?.children).toEqual([]);
    const paths = flatten(result.nodes).map((node) => node.facts.pathFromRoot);
    expect(paths).not.toContain('project-a/src');
  });

  it('the "submodules" strategy pulls children from .gitmodules, and a submodule with its own .git becomes a project', async () => {
    // "lib" is a declared submodule that is itself a repository — round-05 review (claude-07):
    // without a real directory read for it, hasChild(['.git']) can never resolve and "lib" would
    // never be classified `project: true`, no matter what descend strategy is configured.
    const lib = dir({ '.git': dir() });
    const projectA = dir({
      '.git': dir(),
      '.gitmodules': file('[submodule "lib"]\n\tpath = lib\n'),
      lib,
    });
    const testRoot = dir({ 'project-a': projectA });
    const fs = new FakeFileSystem(testRoot);
    const rules: Rule[] = [projectByGitRule()];

    const result = await discoverProjectTree(
      [{ id: 'r', path: '', descend: 'submodules' }],
      rules,
      fs,
      new CancellationSource().signal,
    );

    expect(result.diagnostics).toEqual([]);
    const libNode = findByPath(result.nodes, 'project-a/lib');
    expect(libNode).toBeDefined();
    expect(libNode?.verdict.project).toEqual({ value: true, byRule: 'is-project' });
    // "lib" is itself a project, so it in turn gets its (absent) .gitmodules read, not a real walk.
    expect(libNode?.children).toEqual([]);
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

  it('never starts a read that was only queued for a pool slot when cancellation lands', async () => {
    /**
     * Round-05 review (codex-04): `expandChildren` queues every sibling's read at once via
     * `Promise.all`; the concurrency pool then admits only `concurrency` of them immediately and
     * defers the rest. The old code checked `throwIfCancelled()` only once, before a read was
     * queued — a read already waiting for a pool slot went ahead and ran once admitted, even after
     * cancellation. Cancelling here while exactly `concurrency` reads are already in flight (the
     * other 3 of 5 siblings still queued) must keep the read count at that number forever, not
     * merely lower than "all 5".
     */
    const source = new CancellationSource();
    const CHILD_COUNT = 5;
    const CONCURRENCY = 2;
    const children: Record<string, FakeNode> = {};
    for (let index = 0; index < CHILD_COUNT; index += 1) {
      children[`p${String(index)}`] = dir();
    }
    const testRoot = dir(children);
    const fs = new FakeFileSystem(testRoot, {
      beforeRead: (_path, readsSoFar) => {
        // readsSoFar counts the root's own read (1) plus every child read admitted so far —
        // cancel once both pool slots are occupied (root + the 2 concurrently-admitted children).
        if (readsSoFar === 2) source.cancel();
      },
    });

    const options = { concurrency: CONCURRENCY, maxDepth: 2 };
    await expect(
      discoverProjectTree([{ id: 'r', path: '' }], [], fs, source.signal, options),
    ).rejects.toThrow('cancelled');

    expect(fs.readDirectoryCalls).toBe(3); // root + the 2 already-admitted children, never more
  });
});
