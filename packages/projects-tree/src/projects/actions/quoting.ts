import { RenderError, type ShellKind } from './action';

/**
 * Quotes one substituted value for interpolation into a shell command line, per `shell`'s own
 * grammar. Called once per `${...}` match by `render` (render.ts) — never on a whole rendered
 * string: quoting a finished command would also mangle the literal template text the action
 * author wrote around the substitution (docs/plans/projects-tree/02-core.md, package 02-F).
 *
 * Throws `RenderError` when `shell` has no safe representation for `value` at all — currently only
 * `cmd`, for a value containing `"` or `%` (see `quoteForCmd`'s doc comment). A thrown diagnostic is
 * the contract's answer to "unsafe": never a strategy that emits characters this function cannot
 * prove are inert in the target shell.
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
 * but **not** `%` — percent-expansion of `%VAR%` happens even inside a quoted region.
 *
 * A value containing `%` is rejected outright, not "handled" by doubling it. Doubling (`%%` ->
 * literal `%`) is a **batch-file** rule: cmd's batch parser makes a dedicated pass over a script
 * file that folds `%%` to `%` before the rest of parsing sees it. `ActionSpec.terminal` never runs a
 * batch file — `Terminal.sendText` (api-facts.md fact 11) types the rendered string into a live,
 * interactive cmd.exe, and the interactive command-line parser has no such folding pass: review-05
 * (package R4, review-05/REPORT.md M6, findings codex-01 / claude-12) caught an earlier version of
 * this function asserting "in both batch and interactive parsing" in this very comment, a claim
 * lifted from batch-file documentation without checking it against the sink this code actually
 * targets. Left uncorrected, `%%USERPROFILE%%` in the rendered command stays `%USERPROFILE%` for the
 * interactive parser and gets expanded — silent data corruption at best, and if an attacker controls
 * the value and an environment variable of their choosing exists, a value substitution they chose,
 * not the one the action author's template specified. This codebase has no Windows box and no live
 * cmd.exe to confirm a correct interactive-mode replacement against (review-05's cmd-quoting finding
 * was itself marked `unverifiable` for the same reason) — rejecting outright, exactly like the `"`
 * case below, is the answer that does not require that confirmation: a refused value is safe by
 * construction, an "escaped" one is only safe if the escape is right.
 * TODO(Windows verification): before replacing this rejection with real interactive-mode cmd.exe
 * quoting for `%`, confirm on a live Windows cmd.exe — not batch, not PowerShell's cmd
 * compatibility shim — what interactive `cmd.exe` actually does with `%%` typed at the prompt
 * (inside and outside a quoted region) versus piped via `Terminal.sendText`, and whether any
 * quoting scheme survives a value like `%%cd%%` where the doubled form still parses as a valid
 * (differently-named) environment variable.
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
  if (value.includes('%')) {
    throw new RenderError(
      'unsafeValue',
      "Value contains '%', which cmd.exe expands even inside a quoted region in interactive " +
        'parsing; doubling it is a batch-file-only rule and does not apply here.',
    );
  }
  return `"${value}"`;
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
