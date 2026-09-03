/**
 * Strategy for getting a project's children (`docs/plans/projects-tree/02-core.md`, package 02-E).
 *
 * `descend` is a strategy for *where children come from*, not a rule verdict: `stopDescend`
 * (`classification/`) answers "stop here or not", `DescendStrategy` answers "if not stopped, where
 * do this project's children come from". A round-02 plan revision tried to fold `descend` into the
 * rule engine and found it unrepresentable — `submodules` needs a different children *source* (a
 * list parsed from a file), not a different verdict — so it stays a separate mechanism here rather
 * than a rule.
 *
 * `submodules` reads exactly one file — the project's own `.gitmodules` — instead of walking the
 * project's directory tree: `vendor`, `node_modules`, `.git` are never read. `childrenOfProject`
 * never calls `FileSystemReader.readDirectory`; existence of a declared submodule path is checked
 * with `identity` (a stat, not a directory listing) so an uninitialized submodule can be dropped
 * without walking anything.
 *
 * `full` (a genuine walk into a project's own tree) is deliberately not a value of
 * `DescendStrategy`: `submodules` covers the shipped use case at a fraction of the cost, and `full`
 * would need every cost limiter this package already has plus more. Revisit if monorepos with
 * non-submodule subprojects become a requirement.
 */
import { createClassifier, type NodeFacts, type Rule } from '../classification/index.js';
import type { CancellationSignal } from './cancellation.js';
import { FileSystemError, type FileSystemReader } from './file-system.js';
import type { ClassifiedNode } from './walker.js';
import { parseGitmodules, type GitmoduleEntry } from './gitmodules.js';

export type DescendStrategy = 'stop' | 'submodules';

export type DescendDiagnosticKind =
  'gitmodulesReadError' | 'gitmodulesParseError' | 'gitmodulesPathEscapesProject';

export interface DescendDiagnostic {
  readonly rootId: string;
  readonly path: string;
  readonly kind: DescendDiagnosticKind;
  readonly message: string;
}

export interface DescendContext {
  readonly fs: FileSystemReader;
  readonly rules: readonly Rule[];
  readonly signal: CancellationSignal;
  /**
  Depth from the root, same absolute budget `walker.ts` enforces (`docs/plans/projects-tree/
  02-core.md`, package 02-D): a submodule mounted below this depth is not descended into. Independent
  of `stopDescend` — either one stops descent on its own.
  */
  readonly maxDepth: number;
}

export interface DescendResult {
  readonly children: readonly ClassifiedNode[];
  readonly diagnostics: readonly DescendDiagnostic[];
}

/**
 * Computes `node`'s children per `strategy`. For `'submodules'`, a nested submodule (one declared
 * inside a submodule's own `.gitmodules`) is expanded with the same strategy, recursively, bounded
 * by the same `maxDepth` — there is no second stopping mechanism for nesting.
 */
export async function childrenOfProject(
  node: ClassifiedNode,
  strategy: DescendStrategy,
  context: DescendContext,
): Promise<DescendResult> {
  if (strategy === 'stop') {
    return { children: [], diagnostics: [] };
  }
  return readSubmoduleChildren(node.facts, context);
}

const GITMODULES_MAX_BYTES = 1_048_576;

async function readSubmoduleChildren(
  parentFacts: NodeFacts,
  context: DescendContext,
): Promise<DescendResult> {
  const diagnostics: DescendDiagnostic[] = [];
  if (parentFacts.depthFromRoot >= context.maxDepth) {
    return { children: [], diagnostics };
  }

  context.signal.throwIfCancelled();
  const gitmodulesPath = joinPath(parentFacts.absolutePath, '.gitmodules');

  let content: string;
  try {
    content = await context.fs.readFile(gitmodulesPath, GITMODULES_MAX_BYTES);
  } catch (error) {
    if (error instanceof FileSystemError && error.code === 'notFound') {
      return { children: [], diagnostics }; // no .gitmodules — the project is a leaf, not an error
    }
    diagnostics.push(
      toDiagnostic(parentFacts.rootId, gitmodulesPath, 'gitmodulesReadError', error),
    );
    return { children: [], diagnostics };
  }

  let entries: readonly GitmoduleEntry[];
  try {
    entries = parseGitmodules(content);
  } catch (error) {
    diagnostics.push(
      toDiagnostic(parentFacts.rootId, gitmodulesPath, 'gitmodulesParseError', error),
    );
    return { children: [], diagnostics };
  }

  const accepted: GitmoduleEntry[] = [];
  for (const entry of entries) {
    const segments = resolveSegments(entry.path);
    if (segments === undefined) {
      diagnostics.push(
        toDiagnostic(
          parentFacts.rootId,
          gitmodulesPath,
          'gitmodulesPathEscapesProject',
          new Error(`Submodule "${entry.name}" declares a path outside the project: ${entry.path}`),
        ),
      );
      continue;
    }
    accepted.push(entry);
  }

  const initialized = await filterExisting(accepted, parentFacts.absolutePath, context.fs);
  const trie = buildPathTrie(initialized);
  const classifier = createClassifier(context.rules);
  const { children, diagnostics: nestedDiagnostics } = await trieToChildren(
    trie,
    parentFacts,
    context,
    classifier,
  );
  diagnostics.push(...nestedDiagnostics);
  return { children, diagnostics };
}

/**
 * Drops declared submodules whose directory does not exist — "объявленный сабмодуль не
 * инициализирован" in the plan: `git submodule` leaves the mount point missing until `init`+
 * `update`, and such a node must not appear. Existence is checked with `identity` (a stat of the
 * path), never `readDirectory` — the DoD's "reads no directory inside the project" invariant covers
 * this call too.
 */
async function filterExisting(
  entries: readonly GitmoduleEntry[],
  projectPath: string,
  fs: FileSystemReader,
): Promise<readonly GitmoduleEntry[]> {
  const checked = await Promise.all(
    entries.map(async (entry) => {
      try {
        await fs.identity(joinPath(projectPath, entry.path));
        return entry;
      } catch {
        return;
      }
    }),
  );
  return checked.filter((entry): entry is GitmoduleEntry => entry !== undefined);
}

/**
 * One segment of a declared submodule path, structured so that a multi-segment path (e.g.
 * `libs/vendor/foo`) produces intermediate directory nodes shared by every submodule under the same
 * prefix, instead of one node per submodule with no intermediates.
 */
interface PathTrieNode {
  submodule: GitmoduleEntry | undefined;
  readonly children: Map<string, PathTrieNode>;
}

function buildPathTrie(entries: readonly GitmoduleEntry[]): PathTrieNode {
  const root: PathTrieNode = { submodule: undefined, children: new Map() };
  for (const entry of entries) {
    const segments = resolveSegments(entry.path);
    if (segments === undefined) continue; // already rejected and diagnosed by the caller
    let node = root;
    for (const segment of segments) {
      let next = node.children.get(segment);
      if (next === undefined) {
        next = { submodule: undefined, children: new Map() };
        node.children.set(segment, next);
      }
      node = next;
    }
    node.submodule = entry;
  }
  return root;
}

interface ParentContext {
  readonly rootId: string;
  readonly absolutePath: string;
  readonly pathFromRoot: string;
  readonly depthFromRoot: number;
}

async function trieToChildren(
  trie: PathTrieNode,
  parent: ParentContext,
  context: DescendContext,
  classifier: ReturnType<typeof createClassifier>,
): Promise<{ children: readonly ClassifiedNode[]; diagnostics: readonly DescendDiagnostic[] }> {
  if (parent.depthFromRoot >= context.maxDepth) {
    return { children: [], diagnostics: [] };
  }

  const diagnostics: DescendDiagnostic[] = [];
  const children: ClassifiedNode[] = [];

  for (const [segment, childTrie] of trie.children) {
    context.signal.throwIfCancelled();
    const facts: NodeFacts = {
      rootId: parent.rootId,
      absolutePath: joinPath(parent.absolutePath, segment),
      pathFromRoot: parent.pathFromRoot === '' ? segment : `${parent.pathFromRoot}/${segment}`,
      name: segment,
      depthFromRoot: parent.depthFromRoot + 1,
      entries: [],
    };
    const verdict = classifier.classify(facts);
    if (verdict.skip.value) continue;

    const childContext: ParentContext = {
      rootId: facts.rootId,
      absolutePath: facts.absolutePath,
      pathFromRoot: facts.pathFromRoot,
      depthFromRoot: facts.depthFromRoot,
    };

    // A node whose exact path is a declared submodule gets its children from *its own*
    // .gitmodules — the "nested submodule" case, applying the same strategy recursively — while a
    // purely structural intermediate node gets its children from the rest of the trie.
    const nested =
      childTrie.submodule === undefined
        ? await trieToChildren(childTrie, childContext, context, classifier)
        : await readSubmoduleChildren(facts, context);
    diagnostics.push(...nested.diagnostics);
    children.push({ facts, verdict, children: nested.children });
  }

  return { children, diagnostics };
}

/**
 * Splits a declared submodule path into segments relative to the project, rejecting an absolute
 * path and any path whose `..` segments would climb above the project root — the plan's "путь
 * выходит за пределы проекта" case. Returns `undefined` for a rejected path.
 */
function resolveSegments(path: string): readonly string[] | undefined {
  if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path)) return undefined;
  const segments: string[] = [];
  for (const raw of path.split(/[/\\]+/)) {
    const part = raw.trim();
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.length === 0 ? undefined : segments;
}

function toDiagnostic(
  rootId: string,
  path: string,
  kind: DescendDiagnosticKind,
  error: unknown,
): DescendDiagnostic {
  return { rootId, path, kind, message: error instanceof Error ? error.message : String(error) };
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`;
}
