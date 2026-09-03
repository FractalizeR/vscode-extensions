/**
 * `.gitmodules` parser for the `submodules` descend strategy (`docs/plans/projects-tree/02-core.md`,
 * package 02-E).
 *
 * `.gitmodules` uses git's config-file grammar, not JSON or a flat key=value format: `[submodule
 * "name"]` sections, quoted subsection names that may contain spaces and dots, `#`/`;` comments
 * (both full-line and trailing), backslash line continuations, and case-insensitive keys. This
 * parser only extracts what `descend.ts` needs — each submodule's declared `path` — and is
 * deliberately narrower than a general git-config parser: a section or key this extension does not
 * care about (`[core]`, `url`, `branch`, ...) is ignored rather than rejected, matching git's own
 * tolerance for files that use features outside this parser's scope.
 */

export interface GitmoduleEntry {
  readonly name: string;
  readonly path: string;
}

/**
 * Thrown for content that cannot be tokenized as git-config at all: an unterminated quoted string,
 * or a line starting with `[` that is not a well-formed section header. `descend.ts` catches this —
 * the plan's "файл битый" case — and reports a diagnostic instead of propagating it, leaving the
 * project a leaf rather than failing the whole traversal.
 */
export class GitmodulesParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitmodulesParseError';
  }
}

const SECTION_HEADER = /^\[\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*(?:"((?:[^"\\]|\\.)*)")?\s*]$/;

export function parseGitmodules(content: string): readonly GitmoduleEntry[] {
  // Last `path =` inside a section wins, mirroring git-config's own "later overrides earlier"
  // rule for repeated keys — a file that redefines a submodule's path partway through is not
  // itself malformed.
  const pathBySubmodule = new Map<string, string>();
  let currentSubmodule: string | undefined;

  for (const rawLine of joinContinuations(content)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;

    if (line.startsWith('[')) {
      currentSubmodule = parseSectionHeader(line);
      continue;
    }

    if (currentSubmodule === undefined) continue; // key outside any section this parser tracks

    const parsed = parseKeyValue(line);
    if (parsed?.key.toLowerCase() === 'path') {
      pathBySubmodule.set(currentSubmodule, parsed.value);
    }
  }

  return [...pathBySubmodule].map(([name, path]) => ({ name, path }));
}

/**
 * Joins backslash line continuations (an odd number of trailing backslashes means the final one is
 * unescaped and continues onto the next physical line) and normalizes CRLF/CR/LF before per-line
 * parsing.
 */
function joinContinuations(content: string): readonly string[] {
  const lines: string[] = [];
  let pending = '';
  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const combined = pending + rawLine;
    if (hasUnescapedTrailingBackslash(combined)) {
      pending = combined.slice(0, -1);
      continue;
    }
    lines.push(combined);
    pending = '';
  }
  if (pending !== '') lines.push(pending);
  return lines;
}

function hasUnescapedTrailingBackslash(line: string): boolean {
  let count = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i--) count += 1;
  return count % 2 === 1;
}

/**
 * Returns the submodule name for a `[submodule "name"]` header, or `undefined` for a
 * well-formed header this parser does not track (e.g. `[core]`). Throws for a line starting with
 * `[` that does not parse as a section header at all, and for a `[submodule ...]` header with no
 * quoted name — git requires a subsection there, so its absence means the file is not what it
 * claims to be.
 */
function parseSectionHeader(line: string): string | undefined {
  const match = SECTION_HEADER.exec(line);
  if (match === null) {
    throw new GitmodulesParseError(`Malformed section header: ${line}`);
  }
  const [, sectionName, quotedName] = match;
  if (sectionName?.toLowerCase() !== 'submodule') return undefined;
  if (quotedName === undefined) {
    throw new GitmodulesParseError(`Submodule section without a quoted name: ${line}`);
  }
  return unescapeQuoted(quotedName);
}

/**
 * Splits `key = value` (or `key=value`, any surrounding whitespace) on the first top-level `=` —
 * safe because keys never contain quotes, so the first `=` on the line is never inside one.
 * Returns `undefined` for a boolean-style bare key (no `=`), which `.gitmodules` never uses for
 * `path` and this parser has no use for.
 */
function parseKeyValue(line: string): { key: string; value: string } | undefined {
  const eq = line.indexOf('=');
  if (eq === -1) return undefined;
  const key = line.slice(0, eq).trim();
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key)) return undefined;
  return { key, value: parseValue(line.slice(eq + 1)) };
}

/**
 * Decodes a value's escapes and quoting, and cuts it off at the first unquoted `#`/`;` (an inline
 * comment) — quoted comment characters, e.g. a path containing `#`, are left alone. Throws if the
 * value ends still inside an open quote.
 */
function parseValue(raw: string): string {
  let out = '';
  let isInQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i);
    if (char === '\\' && i + 1 < raw.length) {
      out += unescapeChar(raw.charAt(i + 1));
      i += 1;
      continue;
    }
    if (char === '"') {
      isInQuotes = !isInQuotes;
      continue;
    }
    if (!isInQuotes && (char === '#' || char === ';')) break;
    out += char;
  }
  if (isInQuotes) {
    throw new GitmodulesParseError(`Unterminated quoted value: ${raw}`);
  }
  return out.trim();
}

function unescapeQuoted(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charAt(i);
    if (char === '\\' && i + 1 < raw.length) {
      out += unescapeChar(raw.charAt(i + 1));
      i += 1;
      continue;
    }
    out += char;
  }
  return out;
}

function unescapeChar(char: string): string {
  if (char === 'n') return '\n';
  if (char === 't') return '\t';
  return char; // \" -> ", \\ -> \, and any other escaped char taken literally
}
