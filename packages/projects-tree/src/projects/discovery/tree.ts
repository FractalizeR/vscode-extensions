/**
 * Multi-root entry point for discovery (`docs/plans/projects-tree/02-core.md`, package 02-D).
 *
 * `discoverProjectTree` walks every root independently — including two roots that overlap on
 * disk, one nested inside the other. Each root gets its own `rootId`, and every node's identity
 * downstream (`docs/plans/projects-tree/00-overview.md`, "TreeDataProvider адресует элементы по
 * идентичности объекта") is `rootId` + path, not path alone, so overlapping roots never produce
 * nodes that collide.
 *
 * A node `walkRoot` classifies `project: true` never gets its children from `walkRoot`'s own
 * recursion — `applyDescendStrategy` below replaces them, unconditionally, with whatever
 * `childrenOfProject` (`descend.ts`) computes for the root's `descend` strategy
 * (`docs/plans/projects-tree/00-overview.md`, "Корни и обход внутрь проектов"). Round-05 review
 * (codex-03) found this wiring missing entirely: `descend.ts` was implemented and tested in
 * isolation but never called from here, so `submodules` had no effect on the tree `walkRoot`
 * produced.
 *
 * `walkRoot` never returns the root itself as a node — `result.nodes` is the root's own children.
 * `applyDescendStrategy` therefore runs once per top-level node, not once on a wrapping root node
 * (a real user root containing a repo marker, e.g. `.idea`, must not be classified `project` and
 * collapse the whole tree into itself — see `walker.ts`'s doc comment).
 */
import type { Rule } from '../classification/index.js';
import type { CancellationSignal } from './cancellation.js';
import {
  childrenOfProject,
  type DescendContext,
  type DescendDiagnostic,
  type DescendStrategy,
} from './descend.js';
import type { FileSystemReader } from './file-system.js';
import { walkRoot, type ClassifiedNode, type Limiter, type WalkDiagnostic } from './walker.js';

export type { ClassifiedNode, WalkDiagnostic, WalkDiagnosticKind } from './walker.js';

/**
Either a filesystem-walk diagnostic (`walker.ts`) or one raised while computing a project's
children via its `descend` strategy (`descend.ts`) — the two share a shape (`rootId`, `path`,
`kind`, `message`) but not a `kind` union, since the two mechanisms fail in different ways.
*/
export type DiscoverDiagnostic = WalkDiagnostic | DescendDiagnostic;

/**
The minimal shape discovery needs from a configured root: an id (the anchor `inRoot`/`rootId`
conditions and node identity key against), where it lives on disk, and how a project found under
it gets its children.
*/
export interface DiscoveryRoot {
  readonly id: string;
  readonly path: string;
  /**
  `docs/plans/projects-tree/00-overview.md`, "Корни и обход внутрь проектов": `'stop'` (default) —
  a project is a leaf; `'submodules'` — a project's children come from its `.gitmodules`.
  */
  readonly descend?: DescendStrategy;
}

const DEFAULT_DESCEND_STRATEGY: DescendStrategy = 'stop';

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
  readonly diagnostics: readonly DiscoverDiagnostic[];
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
  const diagnostics: DiscoverDiagnostic[] = [];
  for (const [index, result] of results.entries()) {
    diagnostics.push(...result.diagnostics);
    const descendContext: DescendContext = { fs, rules, signal, maxDepth };
    const strategy = roots[index]?.descend ?? DEFAULT_DESCEND_STRATEGY;
    const rewritten = await Promise.all(
      result.nodes.map((node) => applyDescendStrategy(node, strategy, descendContext, diagnostics)),
    );
    nodes.push(...rewritten);
  }
  return { nodes, diagnostics };
}

/**
 * Rewrites `node`'s subtree so every `project: true` node gets its children from
 * `childrenOfProject` instead of whatever `walkRoot` put there — unconditionally, independent of
 * that node's own `stopDescend` value: the invariant a project's children come only from its
 * `descend` strategy is unconditional, not merely a fallback for when `stopDescend` happened to
 * stop `walkRoot`'s own recursion (round-05 review, "M1" — see `docs/plans/projects-tree/
 * review-05/REPORT.md`). A non-project node's children are walked recursively so a project nested
 * arbitrarily deep under ordinary directories is still found and rewritten.
 */
async function applyDescendStrategy(
  node: ClassifiedNode,
  strategy: DescendStrategy,
  context: DescendContext,
  diagnostics: DiscoverDiagnostic[],
): Promise<ClassifiedNode> {
  if (node.verdict.project.value) {
    const result = await childrenOfProject(node, strategy, context);
    diagnostics.push(...result.diagnostics);
    return { ...node, children: result.children };
  }
  if (node.children.length === 0) return node;
  const children = await Promise.all(
    node.children.map((child) => applyDescendStrategy(child, strategy, context, diagnostics)),
  );
  return { ...node, children };
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
