/**
 * Bridges the canonical rules file on disk (docs/plans/projects-tree/00-overview.md, "Хранение
 * правил") to the pure loader in `src/projects/classification/rules-file.ts`. The file lives at
 * `projects-tree.rules.json` inside `ExtensionContext.globalStorageUri` — a directory the platform
 * does not guarantee exists (api-facts.md, fact 34: only its *parent* is guaranteed) — so an absent
 * file is this module's normal, no-diagnostic case, not an error path.
 *
 * `node:fs/promises`, not `vscode.workspace.fs`: no row in api-facts.md establishes the latter's
 * behavior (error shape, encoding), and `src/editor/**` already uses Node builtins directly
 * elsewhere (`configuration/settings.ts`'s `node:path`) — there is nothing `vscode`-specific about
 * reading a file this module already knows the absolute path to.
 *
 * Only reads. The file's one writer is the rules editor (docs/plans/projects-tree/06-rules-
 * editor.md) — out of scope here, and this module has no write path to keep in sync with it.
 */
import { readFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  DEFAULT_RULES,
  loadRulesFile,
  type Diagnostic,
  type RawActionDefinition,
  type Rule,
} from '../../projects/classification/index.js';

export const RULES_FILE_NAME = 'projects-tree.rules.json';

/**
 * Deliberately not `vscode.ExtensionContext` — this module only ever reads `globalStorageUri.fsPath`
 * off it, and typing the parameter that narrowly means its tests need no `vscode` mock at all (a
 * plain object with that one field satisfies it; a real `ExtensionContext` does too, structurally).
 */
export interface RulesFileLocation {
  readonly globalStorageUri: { readonly fsPath: string };
}

export function rulesFilePath(context: RulesFileLocation): string {
  return nodePath.join(context.globalStorageUri.fsPath, RULES_FILE_NAME);
}

export interface CanonicalRulesResult {
  readonly rules: readonly Rule[];
  /**
  Always present, `[]` whenever no rules file loaded (absent, unreadable, or invalid) — mirrors
  `LoadedRulesFile.actions`'s own "stable array, not optional" contract (`rules-file.ts`). Package
  04-C's composition root feeds this into `createActionRegistry` alongside `BUILT_IN_ACTIONS`, so a
  rules file's own action declarations are runnable, not just referenceable by `primaryAction`.
  */
  readonly actions: readonly RawActionDefinition[];
  /**
  Non-empty only when a rules file existed and failed to read, parse or validate. An absent file is
  not an error (see `loadCanonicalRules`'s doc comment) and reports no diagnostics even though
  `rules` still falls back to `DEFAULT_RULES` in that case too — callers must not use "diagnostics
  is empty" as a proxy for "the file was found."
  */
  readonly diagnostics: readonly Diagnostic[];
}

const FALLBACK_RESULT: CanonicalRulesResult = {
  rules: DEFAULT_RULES,
  actions: [],
  diagnostics: [],
};

/**
 * Loads the canonical rules file, falling back to `DEFAULT_RULES` whenever it cannot be used as-is:
 *
 * - absent (`ENOENT`) — normal for a user who has not opened the rules editor yet; no diagnostic;
 * - unreadable for any other reason (permission denied, path is a directory, ...) — reported as one
 *   diagnostic, since unlike "absent" this is a state the user can plausibly fix;
 * - present but structurally or domain invalid (`loadRulesFile` returns `file: undefined`) — its
 *   diagnostics are returned as-is.
 *
 * In every fallback case the tree still renders, with `DEFAULT_RULES`: a rules file problem must
 * never take the tree down (this module's whole reason to exist, rather than a caller inlining
 * `readFile` and letting a rejection propagate).
 *
 * **The user's rules are layered ON TOP of the defaults, not substituted for them.** Verdicts
 * resolve first-match per field (`classification/classifier.ts`), so a user rule wins on every
 * field it claims while the defaults still answer the fields it says nothing about — which is what
 * makes "add one highlight rule" mean exactly that.
 *
 * Substitution was implemented first and found wrong by a run over a real 181-node tree: a file
 * carrying a single `highlight` rule silently took `repo-marker` with it, so nothing was a project,
 * nothing stopped the descent, and the tree went from 181 nodes to 1865 — a plain directory listing
 * where the user had asked only for a colour. 424 unit and integration tests did not show this;
 * the real-data run did.
 *
 * The cost, stated rather than hidden: a default can no longer be *removed*, only overridden. That
 * is expressible — a higher-priority user rule claiming the same field wins it (e.g. `skip: false`
 * for a name the defaults skip) — and it is the direction that fails safe, because the alternative
 * makes the user's first edit break project detection.
 *
 * `knownActionIds` names ids valid as a `primaryAction` reference *besides* whatever the file's own
 * `actions` section declares (`loadRulesFile`'s own doc comment) — package 04-C's composition root
 * passes `BUILT_IN_ACTIONS`' ids here, closing the debt this module's previous revision left open:
 * until then, a rules file's `primaryAction` could reference only an action the file itself
 * declared, never a built-in one, because nothing outside the file was ever passed in.
 */
export async function loadCanonicalRules(
  context: RulesFileLocation,
  knownActionIds: readonly string[] = [],
): Promise<CanonicalRulesResult> {
  const path = rulesFilePath(context);
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) return FALLBACK_RESULT;
    return {
      rules: DEFAULT_RULES,
      actions: [],
      diagnostics: [{ path: '', message: `could not read rules file: ${describeError(error)}` }],
    };
  }

  const { file, diagnostics } = loadRulesFile(content, knownActionIds);
  if (file === undefined) return { rules: DEFAULT_RULES, actions: [], diagnostics };
  return { rules: [...file.rules, ...DEFAULT_RULES], actions: file.actions, diagnostics: [] };
}

/**
 * Shared with `store.ts` (the write side, package 04-E) — both modules stat/read the same file and
 * need to tell "absent" apart from "exists but unreadable" the same way.
 */
export function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
