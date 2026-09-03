import { compileCondition, type ConditionPredicate, type NodeFacts } from './condition';
import type { Rule } from './rule';
import {
  DEFAULT_VERDICT,
  normalizeVerdict,
  type FieldVerdict,
  type PartialVerdict,
  type Verdict,
  type VerdictFieldName,
} from './verdict';

interface CompiledRule {
  rule: Rule;
  matches: ConditionPredicate;
}

export interface Classifier {
  classify(facts: NodeFacts): Verdict;
}

/**
 * Compiles `rules` once — including every `nameMatches`/`pathMatches` regex, see
 * `condition.ts` — and returns a classifier that evaluates that compiled form against each node.
 * Never call `createClassifier` per node: that would recompile every regex per node, exactly the
 * cost `compileCondition`'s contract exists to avoid.
 */
export function createClassifier(rules: readonly Rule[]): Classifier {
  const compiled: CompiledRule[] = rules.map((rule) => ({
    rule,
    matches: compileCondition(rule.when),
  }));

  return {
    classify(facts: NodeFacts): Verdict {
      const raw: Verdict = {
        skip: resolveField(compiled, 'skip', facts, DEFAULT_VERDICT.skip),
        stopDescend: resolveField(compiled, 'stopDescend', facts, DEFAULT_VERDICT.stopDescend),
        project: resolveField(compiled, 'project', facts, DEFAULT_VERDICT.project),
        primaryAction: resolveField(
          compiled,
          'primaryAction',
          facts,
          DEFAULT_VERDICT.primaryAction,
        ),
        highlight: resolveField(compiled, 'highlight', facts, DEFAULT_VERDICT.highlight),
        tags: resolveField(compiled, 'tags', facts, DEFAULT_VERDICT.tags),
      };
      return normalizeVerdict(raw);
    },
  };
}

/**
 * First-match for a single field, independent of every other field (docs/plans/projects-tree/
 * 00-overview.md, "Ключевая модель данных"): walks `compiled` in order and returns the first
 * enabled rule whose `when` matches `facts` and whose `verdict` has an opinion about `field` —
 * `Object.hasOwn`, not `!== undefined`, because a rule may deliberately set e.g. `primaryAction` to
 * `undefined` (see `PartialVerdict`).
 */
function resolveField<K extends VerdictFieldName>(
  compiled: readonly CompiledRule[],
  field: K,
  facts: NodeFacts,
  fallback: FieldVerdict<Required<PartialVerdict>[K]>,
): FieldVerdict<Required<PartialVerdict>[K]> {
  for (const { rule, matches } of compiled) {
    if (rule.enabled === false) continue;
    if (!Object.hasOwn(rule.verdict, field)) continue;
    if (!matches(facts)) continue;
    // Object.hasOwn above already proved the key is present; PartialVerdict's optional-property
    // typing can't express that at the index-access site, hence the cast.
    return { value: rule.verdict[field] as Required<PartialVerdict>[K], byRule: rule.id };
  }
  return fallback;
}
