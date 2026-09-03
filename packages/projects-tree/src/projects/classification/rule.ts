import type { Condition } from './condition';
import type { PartialVerdict } from './verdict';

/**
 * `id` is the value a `Verdict` field's `byRule` points back to, so it must be stable and unique
 * within a rule set — package 02-B validates that; this type only carries the field. Array order
 * is priority order: for any field two rules both claim, the earlier rule wins (first-match).
 *
 * The field is `verdict`, not the `then` the plan's rules-file JSON format and this repository's
 * docs use — an object with a `then` property is a real Promise thenable in JS: `await`ing a
 * single `Rule` (e.g. inside `rules.map(async (r) => ...)`, or any async function that returns one
 * rule) would silently unwrap it via `then(resolve, reject)` instead of resolving to the rule.
 * Mapping the on-disk `then` to this field is package 02-B's job, when it parses the rules file.
 */
export interface Rule {
  id: string;
  title?: string;
  when: Condition;
  verdict: PartialVerdict;
  /**
  Defaults to `true` when omitted.
  */
  enabled?: boolean;
}
