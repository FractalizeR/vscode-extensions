import { describe, expect, it } from 'vitest';
import type { ActionDefinition, ActionSpec } from '../../../projects/actions/index.js';
import type { RawActionDefinition, RawActionSpec } from '../../../projects/classification/index.js';

/**
 * `classification/rules-file.ts`'s `RawActionSpec`/`RawActionDefinition` are a hand-written
 * structural copy of `projects/actions/action.ts`'s `ActionSpec`/`ActionDefinition` — `classification/`
 * cannot import `actions/` (sibling subject, would-be circular dependency; see `rules-file.ts`'s doc
 * comment) — kept honest only by this file. `registry.ts` in this directory assigns
 * `RawActionDefinition` values straight into a `Map<string, ActionDefinition>`, relying on the two
 * shapes being exactly equal; if a future edit adds, removes, or narrows a field on one side without
 * the other, this file fails to *compile* (not merely to assert) at that line — the type-checker
 * catches the drift `pnpm typecheck`/`pnpm check` already runs, before it can reach `registry.ts`'s
 * runtime behavior silently.
 *
 * `IsEqual` is the standard mutual-conditional-type trick (not `A extends B ? (B extends A ...)`,
 * which misses an added *optional* property — that stays assignable both ways under plain
 * `extends`). The lone type parameter is intentional, not a mistake `no-unnecessary-type-parameters`
 * would otherwise catch: `T` never appears in the emitted signature, it exists purely to make the
 * two conditional types "distributive-checkable" against each other, which is what gives this trick
 * its precision over a direct `A extends B ? B extends A : false`.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- see doc comment above */
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 0) extends <T>() => T extends B ? 1 : 0 ? true : false;
/* eslint-enable @typescript-eslint/no-unnecessary-type-parameters */

describe('ActionSpec/RawActionSpec structural compatibility', () => {
  it('ActionSpec and RawActionSpec are exactly the same shape', () => {
    // Assigning a `false`-typed value where `true` is required is a compile error — that IS the
    // check; the runtime assertion below is only there so the check has a test to live in.
    const isEqual: IsEqual<ActionSpec, RawActionSpec> = true;
    expect(isEqual).toBe(true);
  });

  it('ActionDefinition and RawActionDefinition are exactly the same shape', () => {
    const isEqual: IsEqual<ActionDefinition, RawActionDefinition> = true;
    expect(isEqual).toBe(true);
  });
});
