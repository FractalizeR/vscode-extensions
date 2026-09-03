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
      return quoted.slice(1, -1).replaceAll('%%', '%');
    }
  }
}

const SHELLS: readonly ShellKind[] = ['zsh', 'bash', 'powershell', 'cmd'];

/**
 * `SPECIAL_CHAR_CASES` filtered to those `shell` can actually quote — excludes cmd's rejected `"`
 * case, which the identity-function check below does not apply to (there is no quoted form to
 * compare against a `RenderError` throw).
 */
function quotableCases(shell: ShellKind): typeof SPECIAL_CHAR_CASES {
  return SPECIAL_CHAR_CASES.filter(({ value }) => !(shell === 'cmd' && value.includes('"')));
}

/**
 * The mandatory "special character x shell" matrix (docs/plans/projects-tree/02-core.md, package
 * 02-F DoD). Each value is chosen to be dangerous *if it ever escaped the quoting*: a metacharacter
 * that would start a second command, a substitution, or variable expansion for that specific shell.
 */
const SPECIAL_CHAR_CASES: readonly { label: string; value: string }[] = [
  { label: 'semicolon (command separator)', value: 'evil; rm -rf /' },
  { label: 'double ampersand (conditional chain)', value: 'evil && rm -rf /' },
  { label: 'pipe', value: 'evil | rm -rf /' },
  { label: 'backtick (command substitution)', value: 'evil `rm -rf /`' },
  { label: 'dollar-paren (command substitution)', value: 'evil $(rm -rf /)' },
  { label: 'percent variable (cmd env expansion)', value: 'evil %PATH% end' },
  { label: 'single quote', value: "evil ' end" },
  { label: 'double quote', value: 'evil " end' },
  { label: 'space', value: 'a directory with spaces' },
  { label: 'unicode', value: 'проект 🚀 目录' },
];

describe('quoteForShell — special character x shell matrix', () => {
  for (const shell of SHELLS) {
    describe(shell, () => {
      for (const { label, value } of SPECIAL_CHAR_CASES) {
        const isCmdDoubleQuote = shell === 'cmd' && label === 'double quote';

        it(
          isCmdDoubleQuote
            ? `rejects ${label} — cmd.exe has no safe in-quote escape for it (see quoting.ts)`
            : `quotes ${label} as one literal unit, recoverable by round-trip`,
          () => {
            if (isCmdDoubleQuote) {
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
});

describe('quoteForShell — PowerShell single-quote escaping', () => {
  it('doubles an internal single quote and leaves backtick/$(...) inert', () => {
    expect(quoteForShell("it's", 'powershell')).toBe("'it''s'");
    // Not evaluated: no `$(...)`-subexpression evaluation, no backtick-escape processing inside
    // single quotes — the quoted string carries these characters completely literally.
    expect(quoteForShell('$(whoami) & `echo hi`', 'powershell')).toBe("'$(whoami) & `echo hi`'");
  });
});

describe('quoteForShell — cmd percent-doubling', () => {
  it('doubles every percent sign, including adjacent ones', () => {
    expect(quoteForShell('%USERPROFILE%', 'cmd')).toBe('"%%USERPROFILE%%"');
    expect(quoteForShell('100%', 'cmd')).toBe('"100%%"');
  });
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
