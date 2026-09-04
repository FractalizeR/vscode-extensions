// Public surface of the action-execution subject. Not machine-checked the way projects/*'s
// no-sibling-internals rule is (CORE_SUBJECTS is `classification`/`discovery`/`actions` only,
// `.dependency-cruiser.mjs`), but the same discipline applies by convention: consumers outside this
// directory (package 04-C's composition root, `commands/run-primary-action.ts` and its siblings) go
// through this file, not a deep import into an individual executor module.
//
// `compileAppliesTo`/`AppliesToPredicate`, the five per-kind `*Spec` types, and `ExecutionDecision`/
// `ExecutionGate` are deliberately not re-exported here: `applicableTo` (registry.ts) is the only
// consumer `compileAppliesTo` has, the `*Spec` types are each already exported from the executor
// module that defines them (for that module's own test), and `ExecutionDecision`/`ExecutionGate`'s
// canonical export is `configuration/trust.ts` (see `runner.ts`'s own doc comment on the seam) — a
// second copy here had no consumer and was exactly the kind of dead re-export `knip` exists to
// catch.
export { toRenderNode } from './render-node.js';
export { createActionRegistry, type ActionRegistry } from './registry.js';
export { createActionRunner, runActionById, type ActionRunner } from './runner.js';
export { displayTitleFor } from './display-title.js';
