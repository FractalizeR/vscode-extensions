import { describe, expect, it } from 'vitest';
import {
  CancellationError,
  CancellationSource,
  createNodeFileSystemReader,
  discoverProjectTree,
  FileSystemError,
  GenerationTracker,
  type CancellationSignal,
  type ClassifiedNode,
  type CommitOutcome,
  type DiscoverOptions,
  type DiscoverResult,
  type DiscoveryRoot,
  type FileSystemErrorCode,
  type FileSystemReader,
  type Generation,
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
    };

    const result: DiscoverResult = await discoverProjectTree(
      [root],
      [],
      fakeFs,
      new CancellationSource().signal,
      options,
    );

    const nodes: readonly ClassifiedNode[] = result.nodes;
    const diagnostics: readonly WalkDiagnostic[] = result.diagnostics;
    expect(nodes).toEqual([]);
    const kind: WalkDiagnosticKind | undefined = diagnostics[0]?.kind;
    expect(kind).toBe('notFound');
  });
});
