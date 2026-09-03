import { describe, expect, it } from 'vitest';
import { RenderError, type ShellKind } from './action';
import { encodeForUri, quoteForShell } from './quoting';

/**
 * Reverses `quoteForShell`'s own escaping, independently re-implemented per shell from the same
 * documented rule cited in quoting.ts's comments (not by calling back into quoting.ts). A
 * round-trip through quote -> unquote recovering the exact original bytes is evidence that the
 * quoting function represents the value faithfully as one literal unit for that shell's grammar —
 * this repository's test files cannot spawn a real zsh/bash/PowerShell/cmd process to check that
 * against a live interpreter: `.test.ts` files under `src/projects/` are core, and
 * dependency-cruiser's `no-node-builtins-in-core-logic` forbids `child_process` there (by design —
 * the whole point of the core/adapter split is that core is testable without a live environment).
 */
function unquote(quoted: string, shell: ShellKind): string {
  switch (shell) {
    case 'zsh':
    case 'bash': {
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
      return quoted.slice(1, -1).replaceAll(String.raw`'\''`, "'");
    }
    case 'powershell': {
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
      return quoted.slice(1, -1).replaceAll("''", "'");
    }
    case 'cmd': {
      expect(quoted.startsWith('"')).toBe(true);
      expect(quoted.endsWith('"')).toBe(true);
      // No un-escaping needed: `%` is rejected outright (quoting.ts), so a successfully quoted cmd
      // value never contains one, and `"` is rejected too — nothing quoteForCmd emits needs
      // reversing beyond stripping the wrapping quotes.
      return quoted.slice(1, -1);
    }
  }
}

const SHELLS: readonly ShellKind[] = ['zsh', 'bash', 'powershell', 'cmd'];

/**
 * `SPECIAL_CHAR_CASES` filtered to those `shell` can actually quote — excludes cmd's rejected `"`
 * and `%` cases, which the identity-function check below does not apply to (there is no quoted form
 * to compare against a `RenderError` throw).
 */
function quotableCases(shell: ShellKind): typeof SPECIAL_CHAR_CASES {
  return SPECIAL_CHAR_CASES.filter(
    ({ value }) => !(shell === 'cmd' && (value.includes('"') || value.includes('%'))),
  );
}

/**
 * The mandatory "special character x shell" matrix (docs/plans/projects-tree/02-core.md, package
 * 02-F DoD). Each value is chosen to be dangerous *if it ever escaped the quoting*: a metacharacter
 * that would start a second command, a substitution, or variable expansion for that specific shell.
 */
const SPECIAL_CHAR_CASES: readonly { label: string; value: string }[] = [
  { label: 'semicolon (command separator)', value: 'evil; rm -rf /; evil; rm -rf /' },
  { label: 'double ampersand (conditional chain)', value: 'evil && rm -rf / && evil && rm -rf /' },
  { label: 'pipe', value: 'evil | rm -rf / | evil | rm -rf /' },
  { label: 'backtick (command substitution)', value: 'evil `rm -rf /` evil `rm -rf /`' },
  { label: 'dollar-paren (command substitution)', value: 'evil $(rm -rf /) evil $(rm -rf /)' },
  { label: 'percent variable (cmd env expansion)', value: 'evil %PATH% end %PATH% end' },
  { label: 'single quote', value: "evil ' end ' evil ' end" },
  { label: 'double quote', value: 'evil " end " evil " end' },
  { label: 'space', value: 'a directory with   spaces  in it' },
  { label: 'unicode', value: 'проект проект 🚀 🚀 目录 目录' },
];

/**
 * cmd.exe cannot safely quote a value containing `"` (no in-quote escape at all, quoting.ts) or `%`
 * (percent-expansion happens even inside quotes in interactive parsing — `%%` doubling is a
 * batch-file-only rule, review-05 findings codex-01 / claude-12). Both are rejected outright.
 */
function isRejectedByCmd(value: string): boolean {
  return value.includes('"') || value.includes('%');
}

describe('quoteForShell — special character x shell matrix', () => {
  for (const shell of SHELLS) {
    describe(shell, () => {
      for (const { label, value } of SPECIAL_CHAR_CASES) {
        const isCmdRejection = shell === 'cmd' && isRejectedByCmd(value);

        it(
          isCmdRejection
            ? `rejects ${label} — cmd.exe has no safe in-quote handling for it (see quoting.ts)`
            : `quotes ${label} as one literal unit, recoverable by round-trip`,
          () => {
            if (isCmdRejection) {
              expect(() => quoteForShell(value, shell)).toThrow(RenderError);
              try {
                quoteForShell(value, shell);
                expect.unreachable();
              } catch (error) {
                expect(error).toBeInstanceOf(RenderError);
                expect((error as RenderError).reason).toBe('unsafeValue');
              }
              return;
            }

            const quoted = quoteForShell(value, shell);
            expect(unquote(quoted, shell)).toBe(value);
          },
        );
      }
    });
  }

  it('does not merely pass metacharacters through unmodified — quoting actually changes the raw dangerous value', () => {
    // A quoting function that is secretly the identity function would still pass the round-trip
    // test above by accident (unquote after all only strips shell-specific wrapping). This is the
    // check that catches that: the quoted form must differ from the raw value for every dangerous
    // case, i.e. wrapping/escaping genuinely happened.
    for (const shell of SHELLS) {
      for (const { value } of quotableCases(shell)) {
        expect(quoteForShell(value, shell)).not.toBe(value);
      }
    }
  });
});

describe('quoteForShell — POSIX (zsh/bash) single-quote escaping', () => {
  it('closes, escapes, and reopens the quote for an internal single quote', () => {
    expect(quoteForShell("it's", 'zsh')).toBe(String.raw`'it'\''s'`);
  });

  it(
    'escapes every single quote in a value, not just the first — regression for review-05 ' +
      'finding claude-02: a test that only ever puts one quote in the fixture stays green even ' +
      'if the implementation escapes only the first (replace instead of replaceAll)',
    () => {
      expect(quoteForShell("a'b'c'd", 'zsh')).toBe(String.raw`'a'\''b'\''c'\''d'`);
      expect(quoteForShell("'''", 'bash')).toBe(String.raw`''\'''\'''\'''`);
    },
  );
});

describe('quoteForShell — PowerShell single-quote escaping', () => {
  it('doubles an internal single quote and leaves backtick/$(...) inert', () => {
    expect(quoteForShell("it's", 'powershell')).toBe("'it''s'");
    // Not evaluated: no `$(...)`-subexpression evaluation, no backtick-escape processing inside
    // single quotes — the quoted string carries these characters completely literally.
    expect(quoteForShell('$(whoami) & `echo hi`', 'powershell')).toBe("'$(whoami) & `echo hi`'");
  });

  it(
    'doubles every single quote in a value, not just the first — same replaceAll-vs-replace ' +
      'regression as the POSIX case above, for PowerShell doubling instead of backslash-escaping',
    () => {
      expect(quoteForShell("a'b'c'd", 'powershell')).toBe("'a''b''c''d'");
      expect(quoteForShell("'''", 'powershell')).toBe("''''''''");
    },
  );
});

describe('quoteForShell — cmd: `"` and `%` are both rejected outright', () => {
  it('quotes a value with none of the rejected characters as a plain double-quoted literal', () => {
    expect(quoteForShell('a directory with spaces', 'cmd')).toBe('"a directory with spaces"');
  });

  it(
    'rejects every `%` in the value, not just the first, rather than doubling it — doubling ' +
      '(`%%` -> literal `%`) is a batch-file-only rule that does not fold back for the ' +
      'interactive cmd.exe Terminal.sendText types into (review-05 findings codex-01 / claude-12)',
    () => {
      for (const value of ['%USERPROFILE%', '100%', '%a%b%c%']) {
        expect(() => quoteForShell(value, 'cmd')).toThrow(RenderError);
        try {
          quoteForShell(value, 'cmd');
          expect.unreachable();
        } catch (error) {
          expect(error).toBeInstanceOf(RenderError);
          expect((error as RenderError).reason).toBe('unsafeValue');
        }
      }
    },
  );
});

describe('encodeForUri', () => {
  it('percent-encodes URI structural characters so a value cannot add a path segment or query parameter', () => {
    const value = '/etc/passwd?evil=1&more=2#frag';
    const encoded = encodeForUri(value);
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('?');
    expect(encoded).not.toContain('&');
    expect(encoded).not.toContain('#');
    expect(decodeURIComponent(encoded)).toBe(value);
  });

  it('percent-encodes a literal percent sign, so a raw %XX in the value is not mistaken for existing encoding', () => {
    expect(encodeForUri('100% done')).toBe('100%25%20done');
  });
});
