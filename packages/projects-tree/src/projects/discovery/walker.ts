/**
 * Single-root lazy traversal (`docs/plans/projects-tree/02-core.md`, package 02-D).
 *
 * `walkRoot` reads a node's own directory only when needed: to classify the node itself (a rule
 * that decides `skip`/`stopDescend`/etc. for it needs `hasChild`, which looks at the node's own
 * entries) or to discover its children when descent is allowed. A node whose applicable rules
 * settle every field from name/depth/path alone (`nameMatches`, `depth`, `pathMatches`,
 * `pathEquals`, `inRoot`) and that is not descended into is never read — this is what makes a
 * name-only `skip` rule (e.g. `node_modules`) not touch the filesystem at all.
 *
 * `Condition` is plain data (`classification/condition.ts`), so `requiresEntries` below evaluates it
 * with `hasChild` treated as unknown (three-valued logic) rather than duplicating the rule
 * matching in `classifier.ts` — it reuses `compileCondition` for every other leaf.
 */
import {
  compileCondition,
  createClassifier,
  type Condition,
  type DirEntry,
  type NodeFacts,
  type Rule,
  type Verdict,
  type VerdictFieldName,
} from '../classification/index.js';
import { CancellationError, type CancellationSignal } from './cancellation.js';
import { FileSystemError, type FileSystemReader } from './file-system.js';

export interface ClassifiedNode {
  readonly facts: NodeFacts;
  readonly verdict: Verdict;
  /**
  This node's children, bounded by `maxDepth`/`stopDescend` — not necessarily every directory on
  disk under it. Empty both for a genuine leaf and for a directory the walk chose not to descend
  into; the two are not distinguished here (`docs/plans/projects-tree/02-core.md`, "обход ленивый").
  */
  readonly children: readonly ClassifiedNode[];
  /**
  Whether `facts.entries` reflects a real `readDirectory` call. `NodeFacts.entries` (owned by
  `classification/`) has no room to say this about itself, so `ClassifiedNode` — discovery's own
  wrapper — carries it alongside: `requiresEntries` below can classify a node from name/depth alone
  and never read its directory, leaving `facts.entries` at `[]` the same way a genuinely empty
  directory would (round-05 review, claude-13) — a consumer that cannot tell the two apart risks
  reading "no children" out of a node nobody has actually looked inside.
  */
  readonly entriesRead: boolean;
}

export type WalkDiagnosticKind =
  | 'notFound'
  | 'notDirectory'
  | 'permissionDenied'
  | 'readError'
  | 'brokenSymlink'
  | 'cyclicSymlink';

export interface WalkDiagnostic {
  readonly rootId: string;
  readonly path: string;
  readonly kind: WalkDiagnosticKind;
  readonly message: string;
}

/**
Runs `fn`, deferring to whatever concurrency policy the caller (`tree.ts`) enforces across an
entire multi-root walk — every filesystem read goes through this, not just per-root reads.
*/
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export interface WalkRootParams {
  readonly rootId: string;
  readonly rootPath: string;
  readonly rules: readonly Rule[];
  readonly fs: FileSystemReader;
  readonly signal: CancellationSignal;
  readonly maxDepth: number;
  readonly followSymlinks: boolean;
  readonly runLimited: Limiter;
}

export interface WalkRootResult {
  /**
  The root's own children — never the root itself (see `walkRoot`'s doc comment). Empty when the
  root could not be read, has no directory children, or `maxDepth` is 0.
  */
  readonly nodes: readonly ClassifiedNode[];
  readonly diagnostics: readonly WalkDiagnostic[];
}

interface NodeToExpand {
  readonly rootId: string;
  readonly absolutePath: string;
  readonly pathFromRoot: string;
  readonly name: string;
  readonly depthFromRoot: number;
}

type ReadOutcome = readonly DirEntry[] | { readonly diagnostic: WalkDiagnostic };

export async function walkRoot(params: WalkRootParams): Promise<WalkRootResult> {
  const { rootId, rootPath, rules, fs, signal, maxDepth, followSymlinks, runLimited } = params;
  const classifier = createClassifier(rules);
  const diagnostics: WalkDiagnostic[] = [];
  // Every directory actually read is recorded here when followSymlinks is on, root included —
  // a followed symlink can point at any already-visited ancestor, not only the walk's own root.
  const visitedIdentities = new Set<string>();

  const rootToExpand: NodeToExpand = {
    rootId,
    absolutePath: rootPath,
    pathFromRoot: '',
    name: baseName(rootPath),
    depthFromRoot: 0,
  };

  // The root itself is never classified and never becomes a `ClassifiedNode`: it is a container
  // the walk starts from (a folder configured to hold projects), not a project candidate — a
  // marker directly under it (e.g. `.idea`) must not make the root a `project`/`stopDescend` leaf
  // and collapse the whole tree into one node. `maxDepth` is still counted from the root (0 =
  // nothing, since the root itself is never returned; 1 = the root's own children, unexpanded).
  // The root is still read directly, bypassing the needsEntries() optimization below: a
  // caller-specified root that does not exist, is a file, or is unreadable must be reported
  // regardless of maxDepth or which rules happen to be loaded.
  const rootRead = await readDirectoryTracked(rootToExpand.absolutePath);
  if (isDiagnostic(rootRead)) {
    diagnostics.push(rootRead.diagnostic);
    return { nodes: [], diagnostics };
  }
  const nodes = 0 < maxDepth ? await expandChildren(rootToExpand, rootRead, 1) : [];

  return { nodes, diagnostics };

  async function readDirectoryTracked(path: string): Promise<ReadOutcome> {
    if (followSymlinks) {
      signal.throwIfCancelled();
      let identity: string;
      try {
        // The cancellation check happens again inside the callback passed to runLimited, not only
        // above: a call already queued for a pool slot when cancel() fires must not proceed once
        // admitted — throwIfCancelled() before runLimited only guards work that has not been
        // queued yet (a `Promise.all` over siblings queues every one of them up front).
        identity = await runLimited(() => {
          signal.throwIfCancelled();
          return fs.identity(path);
        });
      } catch (error) {
        if (error instanceof CancellationError) throw error;
        return { diagnostic: toDiagnostic(rootId, path, error, 'brokenSymlink') };
      }
      if (visitedIdentities.has(identity)) {
        return {
          diagnostic: {
            rootId,
            path,
            kind: 'cyclicSymlink',
            message: `Symlink cycle detected at ${path}`,
          },
        };
      }
      visitedIdentities.add(identity);
    }
    signal.throwIfCancelled();
    try {
      return await runLimited(() => {
        signal.throwIfCancelled();
        return fs.readDirectory(path);
      });
    } catch (error) {
      if (error instanceof CancellationError) throw error;
      return { diagnostic: toDiagnostic(rootId, path, error) };
    }
  }

  async function processNode(
    toExpand: NodeToExpand,
    depth: number,
  ): Promise<ClassifiedNode | undefined> {
    const quickFacts: NodeFacts = { ...toExpand, entries: [] };
    let entries: readonly DirEntry[] | undefined;
    let verdict: Verdict;

    if (requiresEntries(rules, quickFacts)) {
      const read = await readDirectoryTracked(toExpand.absolutePath);
      if (isDiagnostic(read)) {
        diagnostics.push(read.diagnostic);
        return undefined;
      }
      entries = read;
      verdict = classifier.classify({ ...toExpand, entries });
    } else {
      verdict = classifier.classify(quickFacts);
    }

    if (verdict.skip.value) {
      return undefined;
    }

    const canDescend = depth < maxDepth && !verdict.stopDescend.value;
    if (!canDescend) {
      return {
        facts: { ...toExpand, entries: entries ?? [] },
        verdict,
        children: [],
        entriesRead: entries !== undefined,
      };
    }

    if (entries === undefined) {
      const read = await readDirectoryTracked(toExpand.absolutePath);
      if (isDiagnostic(read)) {
        // The node itself was already classified successfully (e.g. from its name/depth alone);
        // a directory removed between the parent's listing and this read — "папку удалили между
        // чтением и открытием" — must not drop this already-known node, only its children.
        diagnostics.push(read.diagnostic);
        return { facts: { ...toExpand, entries: [] }, verdict, children: [], entriesRead: false };
      }
      entries = read;
    }

    const children = await expandChildren(toExpand, entries, depth + 1);
    return { facts: { ...toExpand, entries }, verdict, children, entriesRead: true };
  }

  async function expandChildren(
    parent: NodeToExpand,
    parentEntries: readonly DirEntry[],
    childDepth: number,
  ): Promise<readonly ClassifiedNode[]> {
    const candidates = parentEntries.filter(createDirCandidatePredicate(followSymlinks));
    const results = await Promise.all(
      candidates.map((entry) => processNode(buildChildToExpand(parent, entry, rootId), childDepth)),
    );
    return results.filter((node): node is ClassifiedNode => node !== undefined);
  }
}

function isDiagnostic(outcome: ReadOutcome): outcome is { readonly diagnostic: WalkDiagnostic } {
  return !Array.isArray(outcome);
}

function createDirCandidatePredicate(shouldFollowSymlinks: boolean): (entry: DirEntry) => boolean {
  return (entry) =>
    entry.type === 'dir' ||
    (shouldFollowSymlinks && entry.type === 'symlink' && entry.symlinkTarget?.type === 'dir');
}

function buildChildToExpand(parent: NodeToExpand, entry: DirEntry, rootId: string): NodeToExpand {
  return {
    rootId,
    absolutePath: joinPath(parent.absolutePath, entry.name),
    pathFromRoot: parent.pathFromRoot === '' ? entry.name : `${parent.pathFromRoot}/${entry.name}`,
    name: entry.name,
    depthFromRoot: parent.depthFromRoot + 1,
  };
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`;
}

function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

function toDiagnostic(
  rootId: string,
  path: string,
  error: unknown,
  overrideKind?: WalkDiagnosticKind,
): WalkDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  return { rootId, path, kind: overrideKind ?? mapErrorKind(error), message };
}

function mapErrorKind(error: unknown): WalkDiagnosticKind {
  if (!(error instanceof FileSystemError)) {
    return 'readError';
  }
  switch (error.code) {
    case 'notFound': {
      return 'notFound';
    }
    case 'notDirectory': {
      return 'notDirectory';
    }
    case 'permissionDenied': {
      return 'permissionDenied';
    }
    case 'other': {
      return 'readError';
    }
  }
}

const VERDICT_FIELDS: readonly VerdictFieldName[] = [
  'skip',
  'stopDescend',
  'project',
  'primaryAction',
  'highlight',
  'tags',
];

/**
Whether classifying `facts` (whose `entries` is a placeholder — not yet read) requires the node's
real directory listing: true if some rule that could still win a field is ambiguous without it.
*/
function requiresEntries(rules: readonly Rule[], facts: NodeFacts): boolean {
  return VERDICT_FIELDS.some((field) => requiresEntriesForField(rules, field, facts));
}

function requiresEntriesForField(
  rules: readonly Rule[],
  field: VerdictFieldName,
  facts: NodeFacts,
): boolean {
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    if (!Object.hasOwn(rule.verdict, field)) continue;
    const outcome = evaluateTernary(rule.when, facts);
    if (outcome === 'true') return false; // first-match already resolved, no ambiguity left
    if (outcome === 'unknown') return true;
    // 'false' — this rule cannot win the field; keep looking at the next one.
  }
  return false;
}

type Ternary = 'true' | 'false' | 'unknown';

function evaluateTernary(condition: Condition, facts: NodeFacts): Ternary {
  switch (condition.kind) {
    case 'hasChild': {
      return 'unknown';
    }
    case 'all': {
      return combineAll(condition.of.map((child) => evaluateTernary(child, facts)));
    }
    case 'any': {
      return combineAny(condition.of.map((child) => evaluateTernary(child, facts)));
    }
    case 'not': {
      // Mirrors compileCondition's 'not': AND of the negation of each child.
      return combineAll(condition.of.map((child) => negate(evaluateTernary(child, facts))));
    }
    default: {
      return compileCondition(condition)(facts) ? 'true' : 'false';
    }
  }
}

function negate(value: Ternary): Ternary {
  if (value === 'unknown') return 'unknown';
  return value === 'true' ? 'false' : 'true';
}

function combineAll(values: readonly Ternary[]): Ternary {
  if (values.includes('false')) return 'false';
  if (values.includes('unknown')) return 'unknown';
  return 'true';
}

function combineAny(values: readonly Ternary[]): Ternary {
  if (values.includes('true')) return 'true';
  if (values.includes('unknown')) return 'unknown';
  return 'false';
}
