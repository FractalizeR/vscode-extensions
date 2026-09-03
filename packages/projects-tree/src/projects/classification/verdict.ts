import type { HighlightSpec } from './highlight';

/**
The value the engine settled on for one verdict field, and which rule produced it (if any).
*/
export interface FieldVerdict<T> {
  value: T;
  byRule: string | undefined;
}

/**
 * The engine's per-node output. Every field is resolved independently by first-match — a rule that
 * sets `skip` does not shadow another rule's `stopDescend`, and a rule that sets `highlight` does
 * not shadow another rule's `tags`. Two review rounds landed on this: a single combined verdict
 * made highlighting and being a project mutually exclusive, and grouping fields into "axes"
 * reproduced the same defect inside each group (docs/plans/projects-tree/00-overview.md, "Ключевая
 * модель данных").
 */
export interface Verdict {
  skip: FieldVerdict<boolean>;
  stopDescend: FieldVerdict<boolean>;
  project: FieldVerdict<boolean>;
  primaryAction: FieldVerdict<string | undefined>;
  highlight: FieldVerdict<HighlightSpec | undefined>;
  tags: FieldVerdict<readonly string[]>;
}

/**
 * What one `Rule.verdict` may claim about a node. A key's mere presence (checked with
 * `Object.hasOwn`, not `!== undefined`) marks that the rule has an opinion about that field — so a
 * rule can set `primaryAction: undefined` to mean "project, deliberately with no primary action",
 * distinct from omitting the key ("no opinion, let other rules or the default decide").
 */
export interface PartialVerdict {
  skip?: boolean;
  stopDescend?: boolean;
  project?: boolean;
  primaryAction?: string | undefined;
  highlight?: HighlightSpec | undefined;
  tags?: readonly string[];
}

export type VerdictFieldName = keyof PartialVerdict;

/**
Applied when no rule has an opinion about a field.
*/
export const DEFAULT_VERDICT: Verdict = {
  skip: { value: false, byRule: undefined },
  stopDescend: { value: false, byRule: undefined },
  project: { value: false, byRule: undefined },
  primaryAction: { value: undefined, byRule: undefined },
  highlight: { value: undefined, byRule: undefined },
  tags: { value: [], byRule: undefined },
};

/**
 * Applies the incompatible-value normalization the plan defines explicitly (00-overview.md,
 * "Ключевая модель данных"): `skip: true` makes the other fields insignificant (the node is absent
 * from the tree), and `primaryAction` is significant only when `project: true`. "Insignificant" is
 * made concrete here as "reset to the engine default, with no attributed rule" — a caller reading
 * `byRule` on a reset field sees `undefined`, not the id of a rule whose claim no longer applies.
 *
 * `stopDescend` needs no separate reset: it is already covered by the `skip: true` branch below
 * (per the plan, it is significant only when `skip: false`).
 */
export function normalizeVerdict(verdict: Verdict): Verdict {
  let result = verdict;
  if (result.skip.value) {
    result = {
      ...result,
      stopDescend: DEFAULT_VERDICT.stopDescend,
      project: DEFAULT_VERDICT.project,
      primaryAction: DEFAULT_VERDICT.primaryAction,
      highlight: DEFAULT_VERDICT.highlight,
      tags: DEFAULT_VERDICT.tags,
    };
  }
  if (!result.project.value) {
    result = { ...result, primaryAction: DEFAULT_VERDICT.primaryAction };
  }
  return result;
}
