/**
 * Multi-root entry point for discovery (`docs/plans/projects-tree/02-core.md`, package 02-D).
 *
 * `discoverProjectTree` walks every root independently — including two roots that overlap on
 * disk, one nested inside the other. Each root gets its own `rootId`, and every node's identity
 * downstream (`docs/plans/projects-tree/00-overview.md`, "TreeDataProvider адресует элементы по
 * идентичности объекта") is `rootId` + path, not path alone, so overlapping roots never produce
 * nodes that collide.
 */
import type { Rule } from '../classification/index.js';
import type { CancellationSignal } from './cancellation.js';
import type { FileSystemReader } from './file-system.js';
import { walkRoot, type ClassifiedNode, type Limiter, type WalkDiagnostic } from './walker.js';

export type { ClassifiedNode, WalkDiagnostic, WalkDiagnosticKind } from './walker.js';

/**
The minimal shape discovery needs from a configured root: an id (the anchor `inRoot`/`rootId`
conditions and node identity key against) and where it lives on disk.
*/
export interface DiscoveryRoot {
  readonly id: string;
  readonly path: string;
}

export interface DiscoverOptions {
  /**
  Depth from the root; 0 = only the root itself. Default 4, per the prototype.
  */
  readonly maxDepth?: number;
  /**
  Default false: symlinked directories are listed but not descended into.
  */
  readonly followSymlinks?: boolean;
  /**
  Upper bound on concurrent filesystem reads across every root in this call. Default 8.
  */
  readonly concurrency?: number;
}

export interface DiscoverResult {
  readonly nodes: readonly ClassifiedNode[];
  readonly diagnostics: readonly WalkDiagnostic[];
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_CONCURRENCY = 8;

export async function discoverProjectTree(
  roots: readonly DiscoveryRoot[],
  rules: readonly Rule[],
  fs: FileSystemReader,
  signal: CancellationSignal,
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const isFollowSymlinks = options.followSymlinks ?? false;
  const runLimited = createLimiter(options.concurrency ?? DEFAULT_CONCURRENCY);

  const results = await Promise.all(
    roots.map((root) =>
      walkRoot({
        rootId: root.id,
        rootPath: root.path,
        rules,
        fs,
        signal,
        maxDepth,
        followSymlinks: isFollowSymlinks,
        runLimited,
      }),
    ),
  );

  const nodes: ClassifiedNode[] = [];
  const diagnostics: WalkDiagnostic[] = [];
  for (const result of results) {
    if (result.node !== undefined) {
      nodes.push(result.node);
    }
    diagnostics.push(...result.diagnostics);
  }
  return { nodes, diagnostics };
}

/**
 * A fixed-size pool: at most `maxConcurrent` callbacks passed to the returned function run at
 * once, queued in call order — the concurrency limiter every filesystem read (root and recursive
 * alike) in `walker.ts` goes through (`docs/plans/projects-tree/02-core.md`, "конкурентность
 * ограничена пулом").
 */
function createLimiter(maxConcurrent: number): Limiter {
  let active = 0;
  const queue: (() => void)[] = [];

  return async function runLimited<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = queue.shift();
      next?.();
    }
  };
}
