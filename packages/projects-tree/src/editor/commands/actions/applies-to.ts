import { compileCondition, type NodeFacts } from '../../../projects/classification/index.js';
import type { ActionDefinition } from '../../../projects/actions/index.js';

export type AppliesToPredicate = (facts: NodeFacts) => boolean;

/**
 * Compiles `action.appliesTo` into a reusable predicate, once per action rather than once per node
 * — the same reasoning `classification/condition.ts` gives for compiling `nameMatches` regexes at
 * definition time, not match time: a registry evaluates every action against every visible node, so
 * recompiling a condition per call would repeat the same regex/AST work on every filter pass. An
 * action with no `appliesTo` matches every node — `appliesTo` narrows, it never widens.
 */
export function compileAppliesTo(action: ActionDefinition): AppliesToPredicate {
  if (action.appliesTo === undefined) return () => true;
  return compileCondition(action.appliesTo);
}
