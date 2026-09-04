/**
 * The write side of the canonical rules file (docs/plans/projects-tree/00-overview.md, "Хранение
 * правил"; 04-actions.md, package 04-E). `canonical-rules.ts` only reads, merged with
 * `DEFAULT_RULES`, for classification; this module is what "Hide" and "Manage Hidden…"
 * (`commands/hidden.ts`) use to change the file the extension itself wrote.
 *
 * The single-writer rule is enforced by mtime comparison, not a lock: `readRulesFileForEdit` records
 * the mtime a caller read the file at (`undefined` when no file existed yet), and `writeRulesFile`
 * re-stats the file immediately before writing, refusing (rather than silently overwriting) when it
 * moved since then — `checkExternalModification` (`classification/rules-file.ts`) for the case both
 * sides have a file; the two "one side has no file" cases are handled locally, since that function's
 * contract is two mtimes, not "mtime or absence".
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import {
  checkExternalModification,
  CURRENT_RULES_FILE_VERSION,
  loadRulesFile,
  toRawRulesFile,
  type Diagnostic,
  type RawActionDefinition,
  type Rule,
} from '../../projects/classification/index.js';
import {
  describeError,
  isFileNotFound,
  rulesFilePath,
  type RulesFileLocation,
} from './canonical-rules.js';

interface RulesFileForEdit {
  readonly version: number;
  /**
  The user's own rules, exactly as declared on disk — never merged with `DEFAULT_RULES`
  (`loadCanonicalRules` does that merge for classification; a write built from the merged set would
  bake a permanent, code-drifting copy of the defaults into the file — see that function's own doc
  comment on why substitution was tried and found wrong by a real-data run).
  */
  readonly rules: readonly Rule[];
  readonly actions: readonly RawActionDefinition[];
  /**
  `undefined` when no file existed at read time — the normal "rules editor never opened" case, and
  the value `writeRulesFile` must be given back to create the file for the first time.
  */
  readonly mtimeMs: number | undefined;
}

export interface RulesFileForEditResult {
  /**
  `undefined` whenever `diagnostics` is non-empty — mirrors `RulesFileLoadResult`'s own contract
  (`rules-file.ts`): a file with a structural or domain problem is not a base a write can safely
  build on, so callers must not patch a partially-understood file.
  */
  readonly file: RulesFileForEdit | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Reads the on-disk rules file for editing. Unlike `loadCanonicalRules`, an absent file is not a
 * fallback to `DEFAULT_RULES` — it is an empty, unmerged `rules`/`actions` pair at the current format
 * version, exactly what a first write should start from.
 */
export async function readRulesFileForEdit(
  location: RulesFileLocation,
  knownActionIds: readonly string[],
): Promise<RulesFileForEditResult> {
  const path = rulesFilePath(location);

  let mtimeMs: number | undefined;
  try {
    const stats = await stat(path);
    mtimeMs = stats.mtimeMs;
  } catch (error) {
    if (!isFileNotFound(error)) {
      return {
        file: undefined,
        diagnostics: [{ path: '', message: `could not read rules file: ${describeError(error)}` }],
      };
    }
    return {
      file: { version: CURRENT_RULES_FILE_VERSION, rules: [], actions: [], mtimeMs: undefined },
      diagnostics: [],
    };
  }

  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    return {
      file: undefined,
      diagnostics: [{ path: '', message: `could not read rules file: ${describeError(error)}` }],
    };
  }

  const { file, diagnostics } = loadRulesFile(content, knownActionIds);
  if (file === undefined) return { file: undefined, diagnostics };
  return {
    file: { version: file.version, rules: file.rules, actions: file.actions, mtimeMs },
    diagnostics: [],
  };
}

export interface RulesFileWriteContent {
  readonly version: number;
  readonly rules: readonly Rule[];
  readonly actions: readonly RawActionDefinition[];
}

export type RulesFileWriteResult =
  | { readonly ok: true; readonly mtimeMs: number }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * Writes `content` back to disk, refusing when the file moved since `expectedMtimeMs` — the value
 * `readRulesFileForEdit` returned for the read this write is based on. `expectedMtimeMs: undefined`
 * means that read found no file; the write still refuses if one has appeared since (another writer,
 * or a human creating it by hand) rather than clobbering it, the same "never overwrite unseen
 * changes" contract as the defined-mtime case.
 *
 * Creates `globalStorageUri`'s directory if needed (api-facts.md, fact 34: only its *parent* is
 * guaranteed to exist) and writes atomically — a temp file in the same directory, then `rename` over
 * the target, so a crash or an interrupted write leaves either the old file or the new one, never a
 * half-written JSON document that `loadCanonicalRules` would report as invalid on the next refresh.
 *
 * Named limitation (review-07, native-claude-05 and R07-RULES-LOST-UPDATE): comparing `mtimeMs` is
 * not a lock. A write that lands in the same millisecond as this check's own `stat` reports no
 * conflict and is silently overwritten. The second `stat`, immediately before `rename`, narrows —
 * but does not close — the window a competing writer's own write can land in undetected: it still
 * misses a same-millisecond write, and it cannot stop two writers who both pass the first check
 * before either reaches the second (the second `stat` only ever compares against this call's own
 * `currentMtimeMs`, not against whatever a concurrent call just wrote). Real serialization would
 * need content comparison or a lock file, neither of which this stage's plan calls for — see
 * 00-overview.md, "Хранение правил".
 */
export async function writeRulesFile(
  location: RulesFileLocation,
  content: RulesFileWriteContent,
  expectedMtimeMs: number | undefined,
): Promise<RulesFileWriteResult> {
  const path = rulesFilePath(location);
  const dir = nodePath.dirname(path);
  await mkdir(dir, { recursive: true });

  const firstStat = await statMtimeOrUndefined(path, 'check rules file before writing');
  if (!firstStat.ok) return { ok: false, diagnostic: firstStat.diagnostic };
  const currentMtimeMs = firstStat.mtimeMs;

  const conflict = describeConflict(expectedMtimeMs, currentMtimeMs);
  if (conflict !== undefined) return { ok: false, diagnostic: conflict };

  const raw = toRawRulesFile(content.rules, content.actions, content.version);
  const serialized = `${JSON.stringify(raw, null, 2)}\n`;
  // Same directory as the target: `rename` is only atomic within one filesystem, and a temp file
  // elsewhere (e.g. the OS tmpdir) could straddle a filesystem boundary and silently fall back to a
  // non-atomic copy+delete on some platforms.
  const tempPath = nodePath.join(dir, `.${nodePath.basename(path)}.${randomUUID()}.tmp`);
  await writeFile(tempPath, serialized, 'utf8');

  // Re-checked immediately before the rename — the only unavoidable await point between the first
  // check and the swap is `writeFile` above, so this is what "narrow the window" means in this
  // module's own doc comment: fewer await points between check and swap, not a lock. It still
  // cannot see a write that lands in the same millisecond, or two writers who both pass the first
  // check before either reaches this one.
  const recheckStat = await statMtimeOrUndefined(path, 'verify rules file before renaming');
  if (!recheckStat.ok) {
    await cleanupTempFile(tempPath);
    return { ok: false, diagnostic: recheckStat.diagnostic };
  }
  const recheckConflict = describeConflict(currentMtimeMs, recheckStat.mtimeMs);
  if (recheckConflict !== undefined) {
    await cleanupTempFile(tempPath);
    return { ok: false, diagnostic: recheckConflict };
  }

  try {
    await rename(tempPath, path);
  } catch (error) {
    await cleanupTempFile(tempPath);
    throw error;
  }

  const written = await stat(path);
  return { ok: true, mtimeMs: written.mtimeMs };
}

/**
Best-effort cleanup of an abandoned temp file — swallows its own failure, since whatever the
caller is already returning or throwing is what needs to reach them, not a secondary cleanup error.
*/
async function cleanupTempFile(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch {
    // Best-effort; nothing to report.
  }
}

type StatMtimeResult =
  | { readonly ok: true; readonly mtimeMs: number | undefined }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
`context` names the caller's action (e.g. "check rules file before writing") for the diagnostic
message alone — an absent file (`ENOENT`) is not an error here, since `writeRulesFile` treats "no
file yet" as a legitimate starting and ending state, not a failure.
*/
async function statMtimeOrUndefined(path: string, context: string): Promise<StatMtimeResult> {
  try {
    const stats = await stat(path);
    return { ok: true, mtimeMs: stats.mtimeMs };
  } catch (error) {
    if (isFileNotFound(error)) return { ok: true, mtimeMs: undefined };
    return {
      ok: false,
      diagnostic: { path: '', message: `could not ${context}: ${describeError(error)}` },
    };
  }
}

function describeConflict(
  expectedMtimeMs: number | undefined,
  currentMtimeMs: number | undefined,
): Diagnostic | undefined {
  if (expectedMtimeMs === undefined && currentMtimeMs === undefined) return undefined;
  if (expectedMtimeMs === undefined) {
    return {
      path: '',
      message: 'rules file was created on disk since it was last read; reload before writing',
    };
  }
  if (currentMtimeMs === undefined) {
    return {
      path: '',
      message: 'rules file was deleted from disk since it was last read; reload before writing',
    };
  }
  return checkExternalModification(expectedMtimeMs, currentMtimeMs);
}
