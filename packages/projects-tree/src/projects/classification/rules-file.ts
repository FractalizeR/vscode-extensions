import Ajv, { type ValidateFunction } from 'ajv';

import rulesSchema from '../../../schemas/rules.schema.json';
import type { Condition } from './condition';
import type { HighlightSpec } from './highlight';
import type { Rule } from './rule';
import { validateRules, type Diagnostic } from './validation';
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

export interface RawRulesFile {
  version: number;
  rules: readonly RawRule[];
}

export interface LoadedRulesFile {
  version: number;
  rules: readonly Rule[];
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
 * ids, highlight shape) the content of a rules file. Does not read the file itself — `content` is a
 * parameter, not a path: the core is not allowed to import `fs` (docs/plans/projects-tree/02-core.md,
 * "ЖЁСТКИЕ ПРАВИЛА"; enforced by dependency-cruiser's `no-node-builtins-in-core-logic`). Reading the
 * file, and detecting external modification via `mtime` (see `checkExternalModification` below), is
 * the editor adapter's job (stage 03).
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

  const rules = parsed.rules.map((raw) => toInternalRule(raw));
  const domainDiagnostics = validateRules(rules, knownActionIds);
  if (domainDiagnostics.length > 0) {
    return { file: undefined, diagnostics: domainDiagnostics };
  }

  return { file: { version: parsed.version, rules }, diagnostics: [] };
}

/**
 * The inverse of the `then` -> `verdict` mapping `loadRulesFile` applies — used to seed a new rules
 * file with `DEFAULT_RULES` (defaults.ts) and to write edits back out (stage 06). Not schema- or
 * domain-validated: a caller serializing rules this package already validated (its own defaults, or
 * a set that already round-tripped through `loadRulesFile`) has no need to re-check them.
 */
export function toRawRulesFile(
  rules: readonly Rule[],
  version = CURRENT_RULES_FILE_VERSION,
): RawRulesFile {
  return { version, rules: rules.map((rule) => toRawRule(rule)) };
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
