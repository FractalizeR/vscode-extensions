// A synchronous `RegExp` in Node cannot be interrupted once running — no timer, no cancellation
// token reaches it (docs/plans/projects-tree/00-overview.md, "Модель угроз"). The mitigation the
// plan picked instead is a static complexity screen at validation time: reject patterns whose shape
// is known to trigger catastrophic backtracking, before they ever reach `new RegExp` in
// `condition.ts`. This is a heuristic, not a proof: it walks the pattern text looking for three
// well-known triggers (nested quantifiers, overlapping alternation under a quantifier,
// backreferences) and rejects on sight. A pattern that passes this screen is not guaranteed to run
// in linear time — it is only free of *these* triggers; polynomial (non-exponential) backtracking
// from other shapes is a named, accepted residual risk (see `checkRegexComplexity`'s doc comment).
// The condition for revisiting this with a real linear-time engine (e.g. RE2) is named in the plan:
// rule import from an external, untrusted source.

export type RegexSafetyResult =
  { readonly safe: true } | { readonly safe: false; readonly reason: string };

const BACKREFERENCE = /\\(?:[1-9]\d*|k<[^>]+>)/;

/**
 * Screens a `nameMatches`/`pathMatches`-style regex source for constructs that cause catastrophic
 * backtracking: backreferences, a quantifier applied to a group that itself already contains a
 * quantifier (e.g. `(a+)+`, `(a*)+`, `([a-z]+)*`), and a quantifier applied to a group whose
 * top-level alternation branches can overlap (e.g. `(a|aa)+`, `(a|a?)+`, `(\d|\d\d)*`) — the same
 * exponential blowup as nested quantifiers, produced by ambiguity between branches instead of
 * nesting. Deliberately conservative on both fronts: a bounded `(a?)+` is flagged despite its milder
 * blowup, and alternation overlap is approximated by comparing each branch's *first atom* rather
 * than deciding true language overlap (undecidable in general) — `(a|aa)+` and `(a|ab)+` are both
 * flagged even though only the former is a textbook case, because two branches that can start with
 * the same character are exactly the ones the backtracker can confuse. This costs some false
 * positives (a screen with no false positives at all would need to solve regex equivalence); it does
 * not cost false negatives on the shapes this screen targets. Residual risk not covered by any of
 * these three checks — e.g. polynomial (not exponential) backtracking from unanchored sequential
 * quantifiers with no nesting or alternation at all — is not guarded against; see the module's top
 * comment.
 */
export function checkRegexComplexity(pattern: string): RegexSafetyResult {
  if (BACKREFERENCE.test(pattern)) {
    return {
      safe: false,
      reason: String.raw`backreferences (e.g. \1) can cause catastrophic backtracking`,
    };
  }
  const nesting = scanForCatastrophicShapes(pattern);
  if (nesting === 'nestedQuantifier') {
    return {
      safe: false,
      reason:
        'a quantifier applied to a group that already contains one (e.g. (a+)+) can cause catastrophic backtracking',
    };
  }
  if (nesting === 'overlappingAlternation') {
    return {
      safe: false,
      reason:
        'a quantifier applied to a group whose alternation branches can start the same way (e.g. (a|aa)+) can cause catastrophic backtracking',
    };
  }
  return { safe: true };
}

interface GroupFrame {
  hasQuantifiedChild: boolean;
  contentStart: number;
}

interface Quantifier {
  nextIndex: number;
}

type CatastrophicShape = 'nestedQuantifier' | 'overlappingAlternation' | undefined;

/**
 * Scans `pattern` left to right tracking, per open group, whether anything inside it was already
 * quantified, and the group's raw content text — then flags the pattern the moment a group closes
 * with either `hasQuantifiedChild` true, or its content's top-level alternation branches sharing a
 * first atom (`hasOverlappingBranches`), *and* a quantifier immediately follows the closing `)`. Every
 * branch advances `i` by at least one character, so malformed or unbalanced input (which `new
 * RegExp` would reject anyway) cannot loop forever here — it only risks a false negative, never a
 * hang.
 */
function scanForCatastrophicShapes(pattern: string): CatastrophicShape {
  const stack: GroupFrame[] = [{ hasQuantifiedChild: false, contentStart: 0 }];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '(') {
      i = consumeGroupOpen(pattern, i);
      stack.push({ hasQuantifiedChild: false, contentStart: i });
      continue;
    }

    if (ch === ')') {
      const closeIndex = i;
      const closed = stack.pop() ?? { hasQuantifiedChild: false, contentStart: closeIndex };
      i += 1;
      const quantifier = readQuantifier(pattern, i);
      const parent = stack.at(-1);
      if (quantifier) {
        if (closed.hasQuantifiedChild) return 'nestedQuantifier';
        if (hasOverlappingBranches(pattern.slice(closed.contentStart, closeIndex))) {
          return 'overlappingAlternation';
        }
        i = quantifier.nextIndex;
        if (parent) parent.hasQuantifiedChild = true;
      } else if (parent && closed.hasQuantifiedChild) {
        // No quantifier directly on this group, but it contains one — keep that visible to the
        // parent frame so a quantifier further out (applied to an ancestor group) still catches it.
        parent.hasQuantifiedChild = true;
      }
      continue;
    }

    // One atomic unit: an escape sequence, a character class, or a single literal character.
    if (ch === '\\') {
      i += 2;
    } else if (ch === '[') {
      i = skipCharacterClass(pattern, i);
    } else {
      i += 1;
    }

    const quantifier = readQuantifier(pattern, i);
    if (quantifier) {
      i = quantifier.nextIndex;
      const top = stack.at(-1);
      if (top) top.hasQuantifiedChild = true;
    }
  }

  return undefined;
}

/**
 * Splits `content` — the text strictly inside a group, e.g. `a|aa` for `(a|aa)` — on its top-level
 * `|` (one not itself inside a nested group or character class), then checks whether any two
 * branches start with the same atom: the same literal character, the same escape sequence (`\d`
 * equals `\d`, ignoring what follows), or the same character-class source text. An empty branch
 * (`(a|)`) always counts as overlapping — it can match zero-width anywhere the other branch can
 * start, which is exactly the ambiguity this screen exists to catch. Fewer than two branches (no
 * top-level `|` at all) can never overlap with themselves.
 */
function hasOverlappingBranches(content: string): boolean {
  const branches = splitTopLevelAlternatives(content);
  if (branches.length < 2) return false;
  const atoms = branches.map((branch) => firstAtomOf(branch));
  for (const [index, atom] of atoms.entries()) {
    if (atom === '') return true;
    for (let other = index + 1; other < atoms.length; other += 1) {
      if (atoms[other] === '' || atoms[other] === atom) return true;
    }
  }
  return false;
}

function splitTopLevelAlternatives(content: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      i = skipCharacterClass(content, i);
      continue;
    }
    if (ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === '|' && depth === 0) {
      branches.push(content.slice(start, i));
      start = i + 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  branches.push(content.slice(start));
  return branches;
}

/**
 * The first atom of one alternation branch, ignoring any quantifier that trails it — `a` in both
 * `a` and `a?`, `\d` in both `\d` and `\d\d`, the whole bracket expression in `[0-9]...`, and the
 * whole nested group (including its own alternation) in `(?:x|y)...`, since two branches that both
 * start with an equivalent nested group are exactly the overlap this screen is conservative about.
 */
function firstAtomOf(branch: string): string {
  if (branch.length === 0) return '';
  const first = branch[0];
  if (first === '\\') return branch.slice(0, 2);
  if (first === '[') return branch.slice(0, skipCharacterClass(branch, 0));
  if (first === '(') {
    const contentStart = consumeGroupOpen(branch, 0);
    return branch.slice(0, findMatchingClose(branch, contentStart) + 1);
  }
  return branch.slice(0, 1);
}

/**
 * The index of the `)` matching the group whose content starts at `contentStart` (i.e. `depth` is
 * already 1, as if the opening `(`/group-open-modifier was already consumed). Falls back to
 * `pattern.length` on unbalanced input, same fallback tolerance as the rest of this module —
 * `new RegExp` rejects that input anyway.
 */
function findMatchingClose(pattern: string, contentStart: number): number {
  let depth = 1;
  let i = contentStart;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      i = skipCharacterClass(pattern, i);
      continue;
    }
    if (ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return pattern.length;
}

const GROUP_OPEN_SIMPLE_MODIFIERS = new Set([':', '=', '!']);
const LOOKBEHIND_MODIFIERS = new Set(['=', '!']);

/**
 * Advances past `(` and any group-open modifier — `?:`, `?=`, `?!`, `?<=`, `?<!`, `?<name>` — so
 * the caller always lands on the group's actual content, not on syntax that only looks like an
 * atom.
 */
function consumeGroupOpen(pattern: string, index: number): number {
  let i = index + 1;
  if (pattern[i] !== '?') return i;
  i += 1;
  const modifier = pattern[i];
  if (modifier !== undefined && GROUP_OPEN_SIMPLE_MODIFIERS.has(modifier)) {
    return i + 1;
  }
  if (modifier === '<') {
    const lookbehind = pattern[i + 1];
    if (lookbehind !== undefined && LOOKBEHIND_MODIFIERS.has(lookbehind)) {
      return i + 2;
    }
    let j = i + 1;
    while (j < pattern.length && pattern[j] !== '>') j += 1;
    return j + 1;
  }
  return i;
}

function skipCharacterClass(pattern: string, start: number): number {
  let i = start + 1;
  if (pattern[i] === '^') i += 1;
  if (pattern[i] === ']') i += 1; // a leading ']' right after '[' or '[^' is a literal character.
  while (i < pattern.length && pattern[i] !== ']') {
    i += pattern[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

const SINGLE_CHAR_QUANTIFIERS = new Set(['+', '*', '?']);

/**
 * Recognizes `+`, `*`, `?`, and `{m,n}` (with an optional trailing `?` lazy modifier) starting at
 * `index`. Returns `undefined` when no quantifier starts there.
 */
function readQuantifier(pattern: string, index: number): Quantifier | undefined {
  const ch = pattern[index];
  if (ch !== undefined && SINGLE_CHAR_QUANTIFIERS.has(ch)) {
    let next = index + 1;
    if (pattern[next] === '?') next += 1;
    return { nextIndex: next };
  }
  if (ch === '{') {
    const match = /^\{\d+(?:,\d*)?\}/.exec(pattern.slice(index));
    if (match) {
      let next = index + match[0].length;
      if (pattern[next] === '?') next += 1;
      return { nextIndex: next };
    }
  }
  return undefined;
}
