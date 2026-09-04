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
 * `submodules` reads the project's own `.gitmodules` instead of walking the project's directory
 * tree: `vendor`, `node_modules`, `.git` are never read, and the walk never recurses into the
 * project's own tree. The invariant is not "no directory read at all" — a declared submodule's
 * default project rule (`hasChild(['.git', '.idea'])`) cannot resolve from a stub `entries: []`,
 * so a submodule would never itself become a project (round-05 review, claude-07). The invariant
 * `childrenOfProject` actually holds is: **at most one `readDirectory` call per declared
 * submodule, and never for the project itself or a purely structural intermediate node** (a path
 * segment shared by submodules under it, e.g. `libs` in `libs/vendor/foo`, which is never itself a
 * declared submodule and so is never classified against `hasChild`).
 *
 * Existence of a declared submodule path, and whether it stays inside the project, is checked with
 * `realPath` (a stat-family call, not a directory listing) — see `filterAcceptedSubmodules` — so an
 * uninitialized submodule can be dropped, and a symlink escape rejected, without walking anything.
 *
 * `full` (a genuine walk into a project's own tree) is deliberately not a value of
 * `DescendStrategy`: `submodules` covers the shipped use case at a fraction of the cost, and `full`
 * would need every cost limiter this package already has plus more. Revisit if monorepos with
 * non-submodule subprojects become a requirement.
 */
import {
  createClassifier,
  type DirEntry,
  type NodeFacts,
  type Rule,
} from '../classification/index.js';
import type { CancellationSignal } from './cancellation.js';
import { FileSystemError, type FileSystemReader } from './file-system.js';
import type { ClassifiedNode } from './walker.js';
import { parseGitmodules, type GitmoduleEntry } from './gitmodules.js';

export type DescendStrategy = 'stop' | 'submodules';

export type DescendDiagnosticKind =
  | 'gitmodulesReadError'
  | 'gitmodulesParseError'
  | 'gitmodulesPathEscapesProject'
  | 'submoduleReadError';

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

  const { entries: initialized, diagnostics: acceptanceDiagnostics } =
    await filterAcceptedSubmodules(accepted, parentFacts, gitmodulesPath, context.fs);
  diagnostics.push(...acceptanceDiagnostics);
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
 * `update`, and such a node must not appear — and, separately, submodules whose declared path
 * resolves outside the project through a symlink (round-05 review, codex-05): `resolveSegments`
 * only rejects an escape spelled out lexically (`../`, an absolute path); a submodule declared as
 * `path = link`, where `link` is a symlink to `../../etc`, passes that check untouched. Both cases
 * are checked with one `realPath` call per submodule — a stat-family resolve, not a directory
 * listing, so this does not touch the `readDirectory` invariant `childrenOfProject` holds.
 */
async function filterAcceptedSubmodules(
  entries: readonly GitmoduleEntry[],
  parentFacts: NodeFacts,
  gitmodulesPath: string,
  fs: FileSystemReader,
): Promise<{ entries: readonly GitmoduleEntry[]; diagnostics: readonly DescendDiagnostic[] }> {
  if (entries.length === 0) return { entries: [], diagnostics: [] };

  const projectPath = parentFacts.absolutePath;
  let projectRealPath: string;
  try {
    projectRealPath = await fs.realPath(projectPath);
  } catch (error) {
    // The project's own path must exist — this walk already read it. Treated as "cannot verify
    // containment safely" rather than silently skipping the check: every declared submodule of
    // this project is rejected with a diagnostic instead of being accepted unchecked.
    return {
      entries: [],
      diagnostics: [toDiagnostic(parentFacts.rootId, gitmodulesPath, 'submoduleReadError', error)],
    };
  }

  const diagnostics: DescendDiagnostic[] = [];
  const checked = await Promise.all(
    entries.map(async (entry) => {
      const declaredPath = joinPath(projectPath, entry.path);
      let targetRealPath: string;
      try {
        targetRealPath = await fs.realPath(declaredPath);
      } catch {
        return; // not initialized — silently dropped, not an error
      }
      if (isWithin(projectRealPath, targetRealPath)) return entry;
      diagnostics.push(
        toDiagnostic(
          parentFacts.rootId,
          gitmodulesPath,
          'gitmodulesPathEscapesProject',
          new Error(
            `Submodule "${entry.name}" resolves outside the project through a symlink: ${entry.path}`,
          ),
        ),
      );
      return;
    }),
  );
  return {
    entries: checked.filter((entry): entry is GitmoduleEntry => entry !== undefined),
    diagnostics,
  };
}

/**
Whether `target` (a `realPath`-resolved absolute path) is `root` itself or lies under it.
Normalizes backslashes to `/` first so a Windows-style `realPath` result compares the same way as
a POSIX one.
*/
function isWithin(root: string, target: string): boolean {
  const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, '');
  const normalizedTarget = normalizeSlashes(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

function normalizeSlashes(path: string): string {
  return path.replaceAll('\\', '/');
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
    const absolutePath = joinPath(parent.absolutePath, segment);

    // A node whose exact path is a declared submodule needs its own real directory listing: the
    // default project rule (`hasChild(['.git', '.idea'])`) is unresolvable against a stub
    // `entries: []`, so a submodule would never itself be classified `project: true` (round-05
    // review, claude-07). A purely structural intermediate node (a path segment shared by
    // submodules under it, not itself declared) is never a `hasChild` target and gets no read —
    // this is what keeps the invariant at "one read per declared submodule", not one per segment.
    let entries: readonly DirEntry[] = [];
    let wereEntriesRead = false;
    let readDiagnostic: DescendDiagnostic | undefined;
    if (childTrie.submodule !== undefined) {
      try {
        entries = await context.fs.readDirectory(absolutePath);
        wereEntriesRead = true;
      } catch (error) {
        readDiagnostic = toDiagnostic(parent.rootId, absolutePath, 'submoduleReadError', error);
      }
    }

    const facts: NodeFacts = {
      rootId: parent.rootId,
      absolutePath,
      pathFromRoot: parent.pathFromRoot === '' ? segment : `${parent.pathFromRoot}/${segment}`,
      name: segment,
      depthFromRoot: parent.depthFromRoot + 1,
      entries,
    };
    if (readDiagnostic !== undefined) diagnostics.push(readDiagnostic);
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
    children.push({ facts, verdict, children: nested.children, entriesRead: wereEntriesRead });
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
