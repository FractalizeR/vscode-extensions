/**
 * One entry of a directory listing, as reported by the filesystem port (`discovery/file-system.ts`,
 * package 02-D). Declared here, not in `discovery/`, because `NodeFacts.entries` — a classification
 * contract — references it, and `discovery` depends on `classification`, never the reverse
 * (docs/plans/projects-tree/00-overview.md, "Архитектурное решение"). 02-D imports this shape from
 * `classification/index` instead of redeclaring it.
 */
export interface DirEntry {
  name: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  symlinkTarget?: { type: 'file' | 'dir' | 'broken'; deviceAndInode?: string };
}

/**
 * Everything a rule may condition on for one filesystem node. Pure data — no filesystem access
 * happens while evaluating a rule against it.
 */
export interface NodeFacts {
  rootId: string;
  absolutePath: string;
  /**
  Forward-slash separated, always — independent of platform.
  */
  pathFromRoot: string;
  name: string;
  /**
  0 for the root itself.
  */
  depthFromRoot: number;
  entries: readonly DirEntry[];
}

export type Condition =
  | { kind: 'nameMatches'; pattern: string; flags?: string }
  | { kind: 'hasChild'; names: string[]; entryType?: 'file' | 'dir' | 'any' }
  | { kind: 'depth'; min?: number; max?: number }
  | { kind: 'pathMatches'; glob: string; anchor?: 'root' | 'absolute' }
  | { kind: 'pathEquals'; path: string }
  | { kind: 'inRoot'; rootId: string }
  | { kind: 'all' | 'any' | 'not'; of: Condition[] };

export type ConditionPredicate = (facts: NodeFacts) => boolean;

/**
 * Compiles a `Condition` into a predicate closure. Callers (the classifier) must compile a rule's
 * `when` once, at rule-load time, and reuse the resulting predicate for every node — not call this
 * per node. `nameMatches` is the reason: `new RegExp` recompiles the pattern on every call, and a
 * synchronous `RegExp` in Node cannot be interrupted once running, so paying compilation cost per
 * node is also the path to running an expensive pattern once per node instead of once total.
 * Complexity screening for `nameMatches.pattern` (catastrophic backtracking) is package 02-B's
 * job — this function does not screen, and lets `new RegExp` throw on invalid syntax rather than
 * swallowing the error.
 */
export function compileCondition(condition: Condition): ConditionPredicate {
  switch (condition.kind) {
    case 'nameMatches': {
      const regex = new RegExp(condition.pattern, condition.flags);
      return (facts) => {
        // Reset lastIndex unconditionally: a 'g' or 'y' flag makes RegExp#test stateful across
        // calls, and this same compiled regex is reused for every node.
        regex.lastIndex = 0;
        return regex.test(facts.name);
      };
    }
    case 'hasChild': {
      const names = new Set(condition.names);
      const entryType = condition.entryType ?? 'any';
      return (facts) =>
        facts.entries.some(
          (entry) => names.has(entry.name) && (entryType === 'any' || entry.type === entryType),
        );
    }
    case 'depth': {
      const { min, max } = condition;
      return (facts) =>
        (min === undefined || facts.depthFromRoot >= min) &&
        (max === undefined || facts.depthFromRoot <= max);
    }
    case 'pathMatches': {
      const regex = globToRegExp(condition.glob);
      const anchor = condition.anchor ?? 'root';
      return (facts) => {
        const subject = anchor === 'absolute' ? facts.absolutePath : facts.pathFromRoot;
        regex.lastIndex = 0;
        return regex.test(toPosixPath(subject));
      };
    }
    case 'pathEquals': {
      // No `anchor` field on this condition (unlike pathMatches) — root-anchored equality against
      // pathFromRoot is the interpretation consistent with pathMatches' own default anchor.
      const { path } = condition;
      return (facts) => facts.pathFromRoot === path;
    }
    case 'inRoot': {
      const { rootId } = condition;
      return (facts) => facts.rootId === rootId;
    }
    case 'all': {
      const predicates = condition.of.map((child) => compileCondition(child));
      return (facts) => predicates.every((predicate) => predicate(facts));
    }
    case 'any': {
      const predicates = condition.of.map((child) => compileCondition(child));
      return (facts) => predicates.some((predicate) => predicate(facts));
    }
    case 'not': {
      // Shares the { kind; of } shape with 'all'/'any' rather than taking a single child: `not`
      // over a list reads as "none of these match" (De Morgan of 'any'), keeping one shape for
      // all three combinators instead of introducing a fourth.
      const predicates = condition.of.map((child) => compileCondition(child));
      return (facts) => predicates.every((predicate) => !predicate(facts));
    }
  }
}

function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

/**
 * Minimal glob support for `pathMatches`: `*` matches within one path segment, `**` as a whole
 * segment matches zero or more *whole* segments — the standard `.gitignore`/minimatch meaning, so
 * `a/**\/b` matches `a/b` as well as `a/x/b` and `a/x/y/b`, but never `ab` or `aQ/b` — `**` never
 * absorbs part of a neighboring literal segment, only the `/` that separates whole segments.
 * `?` matches one character within a segment. No brace/character-class syntax — not needed by any
 * case in the plan, and every unrecognized character is matched literally rather than silently
 * accepted as a wildcard.
 */
function globToRegExp(glob: string): RegExp {
  // null marks a '**' segment; every other segment is pre-converted to its regex fragment so the
  // join step below only has to decide how segments are stitched together.
  const parts = glob
    .split('/')
    .map((segment) => (segment === '**' ? null : segmentToRegExp(segment)));

  let pattern = '';
  for (const [index, part] of parts.entries()) {
    const isFirst = index === 0;
    const isLast = index === parts.length - 1;
    // Whether the *previous* part was itself a '**' — when it was, it already owns the separating
    // slash on this side (see below), so this part must not emit a second one.
    const isPrevStar = !isFirst && parts[index - 1] === null;

    if (part === null) {
      // A '**' spanning the whole glob matches anything, including nothing. A trailing '**' (with
      // something before it) owns the boundary slash on its *leading* side — the fragment
      // `libs/**` already relied on this. Everywhere else — including a leading '**' — it owns the
      // boundary slash on its *trailing* side instead, and (when something precedes it) that
      // leading side is filled in explicitly below, exactly like a literal segment would.
      //
      // The two styles must never both be skipped for the same '**': that is the pre-fix defect —
      // a middle '**' owned only a trailing slash and no leading one was ever inserted, so
      // `libs(?:.*/)?src` matched `libsX/src` (the literal segment before it became a prefix
      // instead of a whole segment) and even `libssrc` (zero segments merging both literals with
      // no separator at all).
      if (isFirst && isLast) {
        pattern += '.*';
        continue;
      }
      if (isLast) {
        pattern += '(?:/.*)?';
        continue;
      }
      if (!isFirst && !isPrevStar) pattern += '/';
      pattern += '(?:.*/)?';
      continue;
    }
    if (!isFirst && !isPrevStar) {
      pattern += '/';
    }
    pattern += part;
  }
  return new RegExp(`^${pattern}$`);
}

function segmentToRegExp(segment: string): string {
  let pattern = '';
  for (const char of segment) {
    if (char === '*') {
      pattern += '[^/]*';
    } else if (char === '?') {
      pattern += '[^/]';
    } else {
      pattern += escapeRegExpChar(char);
    }
  }
  return pattern;
}

const REGEXP_SPECIAL_CHAR = /[.*+?^${}()|[\]\\]/;

function escapeRegExpChar(char: string): string {
  return REGEXP_SPECIAL_CHAR.test(char) ? `\\${char}` : char;
}
