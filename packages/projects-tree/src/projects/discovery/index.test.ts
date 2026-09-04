import { describe, expect, it } from 'vitest';
import {
  CancellationError,
  CancellationSource,
  childrenOfProject,
  createNodeFileSystemReader,
  discoverProjectTree,
  FileSystemError,
  GenerationTracker,
  GitmodulesParseError,
  parseGitmodules,
  type CancellationSignal,
  type ClassifiedNode,
  type CommitOutcome,
  type DescendContext,
  type DescendDiagnostic,
  type DescendDiagnosticKind,
  type DescendResult,
  type DescendStrategy,
  type DiscoverDiagnostic,
  type DiscoverOptions,
  type DiscoverResult,
  type DiscoveryRoot,
  type FileSystemErrorCode,
  type FileSystemReader,
  type Generation,
  type GitmoduleEntry,
  type WalkDiagnostic,
  type WalkDiagnosticKind,
} from './index.js';

/**
 * `index.ts` is the file every sibling subject (classification/, actions/) must go through per
 * dependency-cruiser's no-sibling-internals rule; nothing outside discovery/ wires it in yet, so
 * this file is what exercises the barrel. It touches every exported name deliberately — a barrel
 * that silently drops or renames one only shows up when something outside the module uses it.
 */
describe('discovery/index — public surface', () => {
  it('re-exports the 02-C cancellation port and lets a source cancel a signal', () => {
    const source = new CancellationSource();
    const signal: CancellationSignal = source.signal;
    expect(signal.cancelled).toBe(false);
    source.cancel();
    expect(() => {
      signal.throwIfCancelled();
    }).toThrow(CancellationError);
  });

  it('re-exports the 02-C generation tracker with a working begin/isCurrent/commit cycle', () => {
    const tracker = new GenerationTracker();
    const generation: Generation = tracker.begin();
    const outcome: CommitOutcome<string> = tracker.commit(generation, 'result');
    expect(outcome).toEqual({ applied: true, result: 'result' });
  });

  it('exposes the FileSystemReader port shape and the real Node-backed implementation', () => {
    const reader: FileSystemReader = createNodeFileSystemReader();
    expect(typeof reader.readDirectory).toBe('function');
    expect(typeof reader.readFile).toBe('function');
    expect(typeof reader.identity).toBe('function');
    const code: FileSystemErrorCode = 'notFound';
    expect(new FileSystemError(code, 'x').code).toBe('notFound');
  });

  it('exposes discoverProjectTree and the tree/diagnostic types it returns', async () => {
    const root: DiscoveryRoot = { id: 'r', path: '/does-not-exist-for-this-smoke-test' };
    const options: DiscoverOptions = { maxDepth: 0 };
    const fakeFs: FileSystemReader = {
      readDirectory: () => Promise.reject(new FileSystemError('notFound', 'no such path')),
      readFile: () => Promise.reject(new Error('unused')),
      identity: () => Promise.reject(new Error('unused')),
      realPath: () => Promise.reject(new Error('unused')),
    };

    const result: DiscoverResult = await discoverProjectTree(
      [root],
      [],
      fakeFs,
      new CancellationSource().signal,
      options,
    );

    const nodes: readonly ClassifiedNode[] = result.nodes;
    const diagnostics: readonly DiscoverDiagnostic[] = result.diagnostics;
    expect(nodes).toEqual([]);
    // A missing root can only ever produce a walker-side diagnostic, never a descend-strategy one.
    const [walkDiagnostic]: readonly WalkDiagnostic[] = diagnostics as readonly WalkDiagnostic[];
    const kind: WalkDiagnosticKind | undefined = walkDiagnostic?.kind;
    expect(kind).toBe('notFound');
  });

  it('exposes parseGitmodules/GitmoduleEntry and GitmodulesParseError for the submodules strategy', () => {
    const entries: readonly GitmoduleEntry[] = parseGitmodules('[submodule "lib"]\n\tpath = lib\n');
    expect(entries).toEqual([{ name: 'lib', path: 'lib' }]);
    expect(() => parseGitmodules('[submodule]\n')).toThrow(GitmodulesParseError);
  });

  it('exposes childrenOfProject/DescendStrategy/DescendContext/DescendResult, both strategies', async () => {
    const projectNode: ClassifiedNode = {
      facts: {
        rootId: 'r',
        absolutePath: '/work/project',
        pathFromRoot: '',
        name: 'project',
        depthFromRoot: 0,
        entries: [],
      },
      entriesRead: true,
      verdict: {
        skip: { value: false, byRule: undefined },
        stopDescend: { value: false, byRule: undefined },
        project: { value: true, byRule: undefined },
        primaryAction: { value: undefined, byRule: undefined },
        highlight: { value: undefined, byRule: undefined },
        tags: { value: [], byRule: undefined },
      },
      children: [],
    };
    const fakeFs: FileSystemReader = {
      readDirectory: (path) =>
        path === '/work/project/lib'
          ? Promise.resolve([])
          : Promise.reject(new FileSystemError('notFound', `no such path: ${path}`)),
      readFile: (path) =>
        path === '/work/project/.gitmodules'
          ? Promise.resolve('[submodule "lib"]\n\tpath = lib\n')
          : Promise.reject(new FileSystemError('notFound', `no such path: ${path}`)),
      identity: () => Promise.reject(new Error('unused')),
      realPath: (path) =>
        path === '/work/project' || path === '/work/project/lib'
          ? Promise.resolve(path)
          : Promise.reject(new FileSystemError('notFound', `no such path: ${path}`)),
    };
    const context: DescendContext = {
      fs: fakeFs,
      rules: [],
      signal: new CancellationSource().signal,
      maxDepth: 4,
    };

    const stopStrategy: DescendStrategy = 'stop';
    const stopResult: DescendResult = await childrenOfProject(projectNode, stopStrategy, context);
    expect(stopResult).toEqual({ children: [], diagnostics: [] });

    const submodulesStrategy: DescendStrategy = 'submodules';
    const submodulesResult: DescendResult = await childrenOfProject(
      projectNode,
      submodulesStrategy,
      context,
    );
    expect(submodulesResult.diagnostics).toEqual([]);
    expect(submodulesResult.children).toHaveLength(1);
    expect(submodulesResult.children.at(0)?.facts.name).toBe('lib');
  });

  it('reports a gitmodulesParseError DescendDiagnostic for a malformed .gitmodules, without throwing', async () => {
    const projectNode: ClassifiedNode = {
      facts: {
        rootId: 'r',
        absolutePath: '/work/broken-project',
        pathFromRoot: '',
        name: 'broken-project',
        depthFromRoot: 0,
        entries: [],
      },
      entriesRead: true,
      verdict: {
        skip: { value: false, byRule: undefined },
        stopDescend: { value: false, byRule: undefined },
        project: { value: true, byRule: undefined },
        primaryAction: { value: undefined, byRule: undefined },
        highlight: { value: undefined, byRule: undefined },
        tags: { value: [], byRule: undefined },
      },
      children: [],
    };
    const fakeFs: FileSystemReader = {
      readDirectory: () => Promise.reject(new Error('unused')),
      readFile: () => Promise.resolve('[submodule]\n'), // no quoted name — malformed
      identity: () => Promise.reject(new Error('unused')),
      realPath: () => Promise.reject(new Error('unused')),
    };
    const context: DescendContext = {
      fs: fakeFs,
      rules: [],
      signal: new CancellationSource().signal,
      maxDepth: 4,
    };

    const result: DescendResult = await childrenOfProject(projectNode, 'submodules', context);

    expect(result.children).toEqual([]);
    const diagnostics: readonly DescendDiagnostic[] = result.diagnostics;
    const kind: DescendDiagnosticKind | undefined = diagnostics[0]?.kind;
    expect(kind).toBe('gitmodulesParseError');
  });
});
