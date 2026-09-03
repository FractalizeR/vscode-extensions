// A synchronous `RegExp` in Node cannot be interrupted once running — no timer, no cancellation
// token reaches it (docs/plans/projects-tree/00-overview.md, "Модель угроз"). The mitigation the
// plan picked instead is a static complexity screen at validation time: reject patterns whose shape
// is known to trigger catastrophic backtracking, before they ever reach `new RegExp` in
// `condition.ts`. This is a heuristic, not a proof: it walks the pattern text looking for the two
// well-known triggers (nested quantifiers, backreferences) and rejects on sight. A pattern that
// passes this screen is not guaranteed to run in linear time — it is only free of *these* two
// triggers. The condition for revisiting this with a real linear-time engine (e.g. RE2) is named in
// the plan: rule import from an external, untrusted source.

export type RegexSafetyResult =
  { readonly safe: true } | { readonly safe: false; readonly reason: string };

const BACKREFERENCE = /\\(?:[1-9]\d*|k<[^>]+>)/;

/**
 * Screens a `nameMatches`/`pathMatches`-style regex source for constructs that cause catastrophic
 * backtracking: backreferences, and a quantifier applied to a group that itself already contains a
 * quantifier (e.g. `(a+)+`, `(a*)+`, `([a-z]+)*`). Deliberately conservative — a bounded `(a?)+`
 * is flagged too, even though its blowup is milder than an unbounded one, because distinguishing the
 * two reliably from the pattern text alone is not worth the extra surface for a screen that already
 * disclaims linearity guarantees.
 */
export function checkRegexComplexity(pattern: string): RegexSafetyResult {
  if (BACKREFERENCE.test(pattern)) {
    return {
      safe: false,
      reason: String.raw`backreferences (e.g. \1) can cause catastrophic backtracking`,
    };
  }
  if (hasNestedQuantifier(pattern)) {
    return {
      safe: false,
      reason:
        'a quantifier applied to a group that already contains one (e.g. (a+)+) can cause catastrophic backtracking',
    };
  }
  return { safe: true };
}

interface GroupFrame {
  hasQuantifiedChild: boolean;
}

interface Quantifier {
  nextIndex: number;
}

/**
 * Scans `pattern` left to right tracking, per open group, whether anything inside it was already
 * quantified — then flags the pattern the moment a group closes with `hasQuantifiedChild` true *and*
 * a quantifier immediately follows the closing `)`. Every branch advances `i` by at least one
 * character, so malformed or unbalanced input (which `new RegExp` would reject anyway) cannot loop
 * forever here — it only risks a false negative, never a hang.
 */
function hasNestedQuantifier(pattern: string): boolean {
  const stack: GroupFrame[] = [{ hasQuantifiedChild: false }];
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '(') {
      i = consumeGroupOpen(pattern, i);
      stack.push({ hasQuantifiedChild: false });
      continue;
    }

    if (ch === ')') {
      const closed = stack.pop() ?? { hasQuantifiedChild: false };
      i += 1;
      const quantifier = readQuantifier(pattern, i);
      const parent = stack.at(-1);
      if (quantifier) {
        if (closed.hasQuantifiedChild) return true;
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

  return false;
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
