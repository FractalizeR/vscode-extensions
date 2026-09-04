import type { RawActionDefinition } from '../../../projects/classification/index.js';
import { BUILT_IN_ACTIONS, type ActionDefinition } from '../../../projects/actions/index.js';
import type { ClassifiedNode } from '../../../projects/discovery/index.js';
import { compileAppliesTo, type AppliesToPredicate } from './applies-to.js';

export interface ActionRegistry {
  byId(id: string): ActionDefinition | undefined;
  /**
  Every registered action whose `appliesTo` matches `node`, built-in and file-declared alike, in
  registration order (built-ins first). `03-A`/`02-B`'s `knownActionIds` want a flat id list, not
  this — use `ids()` for that.
  */
  applicableTo(node: ClassifiedNode): readonly ActionDefinition[];
  /**
  Every known action id, built-in and file-declared. The set `loadRulesFile`'s `knownActionIds`
  parameter is validated against (classification/rules-file.ts) — closes the reconciliation this
  package owes: 03-A wired a `primaryAction` check against built-ins only, this makes user-declared
  actions equally valid references.
  */
  ids(): readonly string[];
}

/**
 * Builds the registry from the fixed built-in set plus whatever `actions` a loaded rules file
 * declared. `RawActionDefinition` (classification/rules-file.ts) is a hand-written structural copy
 * of `ActionDefinition` (projects/actions/action.ts) — the two cannot share a type by import
 * (`rules-file.ts`'s own doc comment: `classification/` may not depend on `actions/`, a sibling
 * subject developed in parallel) — so `fileActions` is assigned straight into the same map as
 * `ActionDefinition` values here, relying on the two shapes staying identical. `action-spec-compat.
 * test.ts` in this directory is what actually enforces that: it fails to *compile* the moment either
 * union drifts from the other, rather than trusting this comment alone.
 *
 * **Collision rule: a file-declared action with the same `id` as a built-in wins.** The alternative
 * — built-in wins — was rejected: the rules file is this extension's one user-facing configuration
 * surface for actions (00-overview.md, "Хранение правил" — settings.json carries no actions or
 * rules), so a user deliberately redefining e.g. `builtin.openAuto` is exercising that surface as
 * designed, not shadowing it by accident. Silently keeping the built-in would make an explicit,
 * validated (`validateActionIds` already rejects *duplicate* file ids, just not a file id that
 * happens to match a built-in) rules-file entry inert with no diagnostic anywhere.
 */
export function createActionRegistry(
  fileActions: readonly RawActionDefinition[] = [],
): ActionRegistry {
  const byIdMap = new Map<string, ActionDefinition>();
  for (const action of BUILT_IN_ACTIONS) byIdMap.set(action.id, action);
  for (const action of fileActions) byIdMap.set(action.id, action);

  // Compiled once per action here, not once per `applicableTo` call — same reasoning as
  // `compileAppliesTo`'s own doc comment, one level up: this registry's `applicableTo` may run
  // against every visible node in the tree.
  const compiled: readonly { action: ActionDefinition; matches: AppliesToPredicate }[] = Array.from(
    byIdMap.values(),
    (action) => ({ action, matches: compileAppliesTo(action) }),
  );

  return {
    byId: (id) => byIdMap.get(id),
    applicableTo: (node) =>
      compiled.filter(({ matches }) => matches(node.facts)).map(({ action }) => action),
    // `Iterator#toArray()` needs a lib this tsconfig's `target`/`lib` (ES2022) does not declare;
    // spread is the alternative that still typechecks.
    // eslint-disable-next-line unicorn/prefer-iterator-to-array
    ids: () => [...byIdMap.keys()],
  };
}
