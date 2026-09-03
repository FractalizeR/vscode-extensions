import { RenderError, type ShellKind } from './action';

/**
 * Quotes one substituted value for interpolation into a shell command line, per `shell`'s own
 * grammar. Called once per `${...}` match by `render` (render.ts) — never on a whole rendered
 * string: quoting a finished command would also mangle the literal template text the action
 * author wrote around the substitution (docs/plans/projects-tree/02-core.md, package 02-F).
 *
 * Throws `RenderError` when `shell` has no safe representation for `value` at all — currently only
 * `cmd` for a value containing `"` (see `quoteForCmd`'s doc comment). A thrown diagnostic is the
 * contract's answer to "unsafe": never a strategy that emits characters this function cannot prove
 * are inert in the target shell.
 */
export function quoteForShell(value: string, shell: ShellKind): string {
  switch (shell) {
    case 'zsh':
    case 'bash': {
      return quoteForPosixShell(value);
    }
    case 'powershell': {
      return quoteForPowerShell(value);
    }
    case 'cmd': {
      return quoteForCmd(value);
    }
  }
}

/**
 * POSIX single-quoting (zsh, bash): inside `'...'`, every character is literal — no metacharacter
 * (`;`, `&&`, `|`, backtick, `$(...)`, `"`, whitespace) is interpreted, and no expansion of any
 * kind happens. The single quote is the one character single-quoting cannot itself represent;
 * the standard escape closes the quote, emits an escaped literal quote, and reopens it:
 * `'` -> `'\''`.
 */
function quoteForPosixShell(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * PowerShell single-quoting: inside `'...'`, PowerShell performs no expansion at all — no variable
 * interpolation, no subexpression evaluation (`$(...)`), no escape processing (backtick is
 * PowerShell's escape character, but only inside double-quoted strings or bare expressions; it is
 * literal inside single quotes). The only escape single-quoting needs is for the single quote
 * itself, doubled: `'` -> `''`.
 */
function quoteForPowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * cmd.exe double-quoting. cmd's own documentation is explicit that quoting is the exception, not
 * the rule, for one character: quotes suppress interpretation of `& | < > ^ ( )` and whitespace,
 * but **not** `%` — percent-expansion of `%VAR%` happens even inside a quoted region. That is
 * mitigated the standard way: doubling every `%` (`%%`) is recognized unconditionally as an escaped
 * literal percent, in both batch and interactive parsing, and takes precedence over matching a
 * `%VAR%` pattern.
 *
 * A value containing `"` is rejected outright rather than "handled": cmd.exe's line parser has no
 * escape for a literal `"` while inside a quoted region — a `"` always toggles quote state, with no
 * exception. cmd's quoted/unquoted state is a single toggle spanning the *entire* command line, not
 * a per-argument scope, so an unbalanced quote from an untrusted value would also expose the
 * template's own literal text (written by the action's author, trusted) to cmd's metacharacter
 * parsing — exactly the injection this function exists to prevent. Every documented workaround
 * (closing the quote, escaping the quote outside of it, reopening the quote) depends on the
 * surrounding characters and is not a closed, provably-safe transformation; Node.js itself shipped
 * a real vulnerability in this exact spot (cmd.exe argument injection via crafted quotes/carets,
 * CVE-2024-27980). Rejecting is the honest answer for this one character on this one shell — see
 * the package report for the write-up this decision is called out in.
 */
function quoteForCmd(value: string): string {
  if (value.includes('"')) {
    throw new RenderError(
      'unsafeValue',
      "Value contains '\"', which cmd.exe cannot safely quote inside a quoted region.",
    );
  }
  return `"${value.replaceAll('%', '%%')}"`;
}

/**
 * Percent-encodes one substituted value for interpolation into a URI template (`RenderTarget`
 * `{ kind: 'uri' }`). Every character that could otherwise change the URI's structure — `/`, `&`,
 * `#`, `?`, `=`, whitespace, `%` itself — is escaped; the substitution can only ever contribute one
 * opaque component value, never new path segments or query parameters.
 */
export function encodeForUri(value: string): string {
  return encodeURIComponent(value);
}
