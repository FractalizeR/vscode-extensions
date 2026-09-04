import Ajv, { type ValidateFunction } from 'ajv';

import rulesSchema from '../../../schemas/rules.schema.json';
import type { Condition } from './condition';
import type { HighlightSpec } from './highlight';
import type { Rule } from './rule';
import { validateCondition, validateRules, type Diagnostic } from './validation';
import type { PartialVerdict } from './verdict';

export type { Diagnostic } from './validation';

/**
 * The only version this build understands. `rules.schema.json` pins `version` to this exact value
 * (`const`), so an unrecognized version surfaces as an ordinary structural diagnostic below rather
 * than a special case here — no separate "unknown version" branch to keep in sync with the schema.
 */
export const CURRENT_RULES_FILE_VERSION = 1;

/**
 * The on-disk shape of one rule. The key is `then`, not `verdict`: see `rule.ts` for why the
 * internal type renamed it (an object with a `then` property is a thenable). `primaryAction` and
 * `highlight` use `null`, not `undefined` — JSON has no `undefined` — to carry the "rule has an
 * opinion, and the opinion is 'no value'" case through serialization (`PartialVerdict`'s own doc
 * comment, `verdict.ts`).
 */
export interface RawRule {
  id: string;
  title?: string;
  when: Condition;
  then: RawPartialVerdict;
  enabled?: boolean;
}

export interface RawPartialVerdict {
  skip?: boolean;
  stopDescend?: boolean;
  project?: boolean;
  primaryAction?: string | null;
  highlight?: HighlightSpec | null;
  tags?: readonly string[];
}

/**
 * The `spec` union of one action definition, as it appears in the canonical rules file. Structurally
 * mirrors `src/projects/actions/action.ts`'s `ActionSpec` — that type cannot be imported here
 * (`actions/` is a sibling package developed in parallel, and `classification/` may not depend on
 * it; see `validateRules`'s doc comment for the same boundary applied to `primaryAction`
 * references). Reconciling the two into one shared type is deferred to stage 04; until then this is
 * a second, hand-written copy of the shape, kept honest only by `rules.schema.json`'s
 * `actionSpec*` definitions and this module's own tests.
 */
export type RawActionSpec =
  | { kind: 'openFolder'; window: 'current' | 'new' | 'auto' }
  | {
      kind: 'terminal';
      command: string;
      shell: 'zsh' | 'bash' | 'powershell' | 'cmd';
      execute?: boolean;
      cwd?: string;
      terminalName?: string;
    }
  | { kind: 'process'; command: string; args: readonly string[] }
  | { kind: 'uri'; template: string }
  | { kind: 'command'; commandId: string; args?: readonly unknown[] };

/**
 * One action definition as it appears in the canonical rules file — the place a `then.primaryAction`
 * reference (validated by `validateRules`) is declared. See `RawActionSpec`'s doc comment for why
 * this is a local copy of `actions/action.ts`'s `ActionDefinition` rather than an import.
 */
export interface RawActionDefinition {
  id: string;
  title?: string;
  appliesTo?: Condition;
  spec: RawActionSpec;
}

export interface RawRulesFile {
  version: number;
  rules: readonly RawRule[];
  /**
  Optional: a rules file with no custom actions omits this entirely rather than carrying `[]`.
  */
  actions?: readonly RawActionDefinition[];
}

export interface LoadedRulesFile {
  version: number;
  rules: readonly Rule[];
  /**
  Always present, `[]` when the file declared none — unlike `RawRulesFile.actions`, which is
  optional on disk, callers of a *loaded* file get a stable array to iterate without a null check.
  */
  actions: readonly RawActionDefinition[];
}

export interface RulesFileLoadResult {
  /**
  `undefined` whenever `diagnostics` is non-empty — a rules file with any problem does not load
  partially, since a rule silently missing from an active set is worse than the set failing to load.
  */
  file: LoadedRulesFile | undefined;
  diagnostics: readonly Diagnostic[];
}

// Compiled once at module load, not per call — the same reasoning `compileCondition` documents for
// `nameMatches` regexes applies to schema compilation too. `rules.schema.json` is imported directly
// (not re-typed by hand) so the runtime loader and the file VS Code's `jsonValidation` points editors
// at are provably the same schema — there is no second, hand-written structural check to drift from
// it silently.
const ajv = new Ajv({ allErrors: true, strict: true });
const validateStructure: ValidateFunction<RawRulesFile> = ajv.compile<RawRulesFile>(rulesSchema);

/**
 * Parses, structurally validates (against `rules.schema.json`, via `ajv`), maps `then` to `verdict`,
 * and domain-validates (`validation.ts`: regex complexity, `primaryAction` references, duplicate
 * rule ids, highlight shape; plus this function's own duplicate-action-id check) the content of a
 * rules file. Does not read the file itself — `content` is a parameter, not a path: the core is not
 * allowed to import `fs` (docs/plans/projects-tree/02-core.md, "ЖЁСТКИЕ ПРАВИЛА"; enforced by
 * dependency-cruiser's `no-node-builtins-in-core-logic`). Reading the file, and detecting external
 * modification via `mtime` (see `checkExternalModification` below), is the editor adapter's job
 * (stage 03).
 *
 * `knownActionIds` names ids that are valid `primaryAction` references *besides* the ones this file
 * declares in its own `actions` section — built-in actions the caller wires in from outside the
 * file, for instance. A `primaryAction` may reference either set; the file's own declared actions
 * need no separate entry in `knownActionIds` to be referenceable.
 */
export function loadRulesFile(
  content: string,
  knownActionIds: readonly string[],
): RulesFileLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { file: undefined, diagnostics: [{ path: '', message: `invalid JSON: ${message}` }] };
  }

  if (!validateStructure(parsed)) {
    return {
      file: undefined,
      diagnostics: (validateStructure.errors ?? []).map((error) => toStructuralDiagnostic(error)),
    };
  }

  const declaredActions = parsed.actions ?? [];
  const rules = parsed.rules.map((raw) => toInternalRule(raw));
  const domainDiagnostics = [
    ...validateActionIds(declaredActions),
    ...validateRules(rules, [...knownActionIds, ...declaredActions.map((action) => action.id)]),
  ];
  if (domainDiagnostics.length > 0) {
    return { file: undefined, diagnostics: domainDiagnostics };
  }

  return { file: { version: parsed.version, rules, actions: declaredActions }, diagnostics: [] };
}

/**
 * Duplicate action ids are this module's own check, not `validation.ts`'s: `validateRules` operates
 * on the internal `Rule[]`/`primaryAction`-reference shape, while `actions` is raw on-disk data this
 * module never converts to an internal type (see `RawActionSpec`'s doc comment).
 *
 * `appliesTo` is validated here too, with `validation.ts`'s own `validateCondition` (R07-ACTION-
 * CONDITION): it is a `Condition`, the same shape and same user-supplied-regex risk as a rule's
 * `when`, but it lives on `RawActionDefinition` — a shape `validateRules` never sees, since that
 * function only walks `rules[]`. Without this, an uncompilable or catastrophic-backtracking
 * `appliesTo` pattern would sail through `loadRulesFile` and only fail once
 * `editor/commands/actions/registry.ts` compiles it — a `SyntaxError` on activation instead of a
 * diagnostic, or a synchronous regexp run on every node with no screening at all.
 */
function validateActionIds(actions: readonly RawActionDefinition[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seenIds = new Set<string>();
  for (const [index, action] of actions.entries()) {
    const base = `/actions/${String(index)}`;
    if (seenIds.has(action.id)) {
      diagnostics.push({ path: `${base}/id`, message: `duplicate action id "${action.id}"` });
    }
    seenIds.add(action.id);

    if (action.appliesTo !== undefined) {
      diagnostics.push(...validateCondition(action.appliesTo, `${base}/appliesTo`));
    }
  }
  return diagnostics;
}

/**
 * The inverse of the `then` -> `verdict` mapping `loadRulesFile` applies — used to seed a new rules
 * file with `DEFAULT_RULES` (defaults.ts) and to write edits back out (stage 06). Not schema- or
 * domain-validated: a caller serializing rules this package already validated (its own defaults, or
 * a set that already round-tripped through `loadRulesFile`) has no need to re-check them.
 */
export function toRawRulesFile(
  rules: readonly Rule[],
  actions: readonly RawActionDefinition[] = [],
  version = CURRENT_RULES_FILE_VERSION,
): RawRulesFile {
  return {
    version,
    rules: rules.map((rule) => toRawRule(rule)),
    ...(actions.length > 0 && { actions }),
  };
}

/**
 * The single writer rule (docs/plans/projects-tree/00-overview.md, "Хранение правил") is enforced
 * here, not by a lock: the adapter records the `mtime` it read the file at, and before writing back
 * asks this function whether the file changed on disk since then. Both timestamps are supplied by
 * the caller — this module has no filesystem access to stat the file itself.
 */
export function checkExternalModification(
  lastReadMtimeMs: number,
  currentMtimeMs: number,
): Diagnostic | undefined {
  if (currentMtimeMs !== lastReadMtimeMs) {
    return {
      path: '',
      message: `rules file changed on disk since it was last read (mtime ${String(lastReadMtimeMs)} -> ${String(currentMtimeMs)}); reload before writing`,
    };
  }
  return undefined;
}

function toStructuralDiagnostic(error: {
  instancePath: string;
  message?: string;
  keyword: string;
  params: Record<string, unknown>;
}): Diagnostic {
  const missingProperty =
    error.keyword === 'required' && typeof error.params.missingProperty === 'string'
      ? `/${error.params.missingProperty}`
      : '';
  return {
    path: `${error.instancePath}${missingProperty}` || '/',
    message: error.message ?? 'does not match the rules file schema',
  };
}

function toInternalRule(raw: RawRule): Rule {
  return {
    id: raw.id,
    ...(raw.title !== undefined && { title: raw.title }),
    when: raw.when,
    verdict: toInternalVerdict(raw.then),
    ...(raw.enabled !== undefined && { enabled: raw.enabled }),
  };
}

function toInternalVerdict(raw: RawPartialVerdict): PartialVerdict {
  return {
    ...(Object.hasOwn(raw, 'skip') && { skip: raw.skip }),
    ...(Object.hasOwn(raw, 'stopDescend') && { stopDescend: raw.stopDescend }),
    ...(Object.hasOwn(raw, 'project') && { project: raw.project }),
    ...(Object.hasOwn(raw, 'primaryAction') && { primaryAction: raw.primaryAction ?? undefined }),
    ...(Object.hasOwn(raw, 'highlight') && { highlight: raw.highlight ?? undefined }),
    ...(Object.hasOwn(raw, 'tags') && { tags: raw.tags }),
  };
}

function toRawRule(rule: Rule): RawRule {
  return {
    id: rule.id,
    ...(rule.title !== undefined && { title: rule.title }),
    when: rule.when,
    // The on-disk key is deliberately `then` (see RawRule's doc comment) — this is a plain data
    // object, JSON.stringify'd or handed to ajv, never awaited.
    // eslint-disable-next-line unicorn/no-thenable
    then: toRawVerdict(rule.verdict),
    ...(rule.enabled !== undefined && { enabled: rule.enabled }),
  };
}

function toRawVerdict(verdict: PartialVerdict): RawPartialVerdict {
  return {
    ...(Object.hasOwn(verdict, 'skip') && { skip: verdict.skip }),
    ...(Object.hasOwn(verdict, 'stopDescend') && { stopDescend: verdict.stopDescend }),
    ...(Object.hasOwn(verdict, 'project') && { project: verdict.project }),
    ...(Object.hasOwn(verdict, 'primaryAction') && {
      primaryAction: verdict.primaryAction ?? null,
    }),
    ...(Object.hasOwn(verdict, 'highlight') && { highlight: verdict.highlight ?? null }),
    ...(Object.hasOwn(verdict, 'tags') && { tags: verdict.tags }),
  };
}
