import { describe, expect, it } from 'vitest';
import ts from 'typescript';

// Re-implemented against the exported extraction primitives is not possible without exporting
// per-file extraction, so this test drives the same AST logic through a minimal harness that mirrors
// `extractFromSourceFile` in check-l10n.ts. Kept here rather than exporting internals from the CLI
// module, whose public surface is deliberately just `extractRuntimeKeys` (directory-based, used by
// both `generate` and `check`).
import { extractRuntimeKeys } from './check-l10n.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';

// Prepended to every fixture. Extraction binds `l10n` through the file's own imports rather than by
// matching the identifier text (round 06, codex-07 / claude-12), so a fixture without the import is
// correctly not an l10n call at all — the harness has to look like a real source file.
const VSCODE_IMPORT = "import * as vscode from 'vscode';\n";

/**
Same as `withTempSourceFile` but writes the fixture verbatim — these cases supply their own import
line, since the import is precisely what is under test.
*/
function withVerbatimSourceFile(source: string, run: (dir: string) => void): void {
  const dir = mkdtempSync(nodePath.join(tmpdir(), 'check-l10n-test-'));
  try {
    writeFileSync(nodePath.join(dir, 'sample.ts'), source, 'utf8');
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withTempSourceFile(contents: string, run: (dir: string) => void): void {
  const dir = mkdtempSync(nodePath.join(tmpdir(), 'check-l10n-test-'));
  try {
    writeFileSync(nodePath.join(dir, 'sample.ts'), VSCODE_IMPORT + contents, 'utf8');
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('extractRuntimeKeys', () => {
  it('extracts a simple string-literal message', () => {
    withTempSourceFile(`vscode.l10n.t('Open Project');\n`, (dir) => {
      const { keys, errors } = extractRuntimeKeys(dir);
      expect(errors).toEqual([]);
      expect(keys.map((k) => k.key)).toEqual(['Open Project']);
    });
  });

  it('extracts a multi-line call with a {0} placeholder and an embedded quote', () => {
    const source = [
      'vscode.window.showWarningMessage(',
      '  vscode.l10n.t(',
      '    \'Ignoring {0} invalid entry/entries in projectsTree.roots — each must be an absolute path, or an object with an absolute "path".\',',
      '    invalid.length,',
      '  ),',
      ');',
      '',
    ].join('\n');
    withTempSourceFile(source, (dir) => {
      const { keys, errors } = extractRuntimeKeys(dir);
      expect(errors).toEqual([]);
      expect(keys).toHaveLength(1);
      expect(keys[0]?.key).toBe(
        'Ignoring {0} invalid entry/entries in projectsTree.roots — each must be an absolute path, or an object with an absolute "path".',
      );
    });
  });

  it('applies the comment suffix from the object-literal call form (fact 49)', () => {
    withTempSourceFile(
      `vscode.l10n.t({ message: 'Refresh', comment: ['view/title icon'] });\n`,
      (dir) => {
        const { keys, errors } = extractRuntimeKeys(dir);
        expect(errors).toEqual([]);
        expect(keys.map((k) => k.key)).toEqual(['Refresh/view/title icon']);
      },
    );
  });

  it('fails loudly on a template literal with interpolation instead of dropping the key', () => {
    withTempSourceFile('vscode.l10n.t(`Hello ${name}`);\n', (dir) => {
      const { keys, errors } = extractRuntimeKeys(dir);
      expect(keys).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.detail).toMatch(/template literal|string literal/i);
    });
  });

  it('fails loudly on a non-literal first argument instead of dropping the key', () => {
    withTempSourceFile('vscode.l10n.t(someVariable);\n', (dir) => {
      const { keys, errors } = extractRuntimeKeys(dir);
      expect(keys).toEqual([]);
      expect(errors).toHaveLength(1);
    });
  });

  it('ignores an unrelated .t() call that is not on an l10n namespace', () => {
    withTempSourceFile("something.t('not a translation key');\n", (dir) => {
      const { keys, errors } = extractRuntimeKeys(dir);
      expect(keys).toEqual([]);
      expect(errors).toEqual([]);
    });
  });

  it('skips nested directories and only reads .ts files, excluding .test.ts', () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'check-l10n-test-'));
    try {
      mkdirSync(nodePath.join(dir, 'nested'));
      writeFileSync(
        nodePath.join(dir, 'nested', 'a.ts'),
        VSCODE_IMPORT + "vscode.l10n.t('Nested');\n",
        'utf8',
      );
      writeFileSync(
        nodePath.join(dir, 'a.test.ts'),
        VSCODE_IMPORT + "vscode.l10n.t('Should not be picked up');\n",
        'utf8',
      );
      writeFileSync(nodePath.join(dir, 'a.d.ts'), 'declare const x: string;\n', 'utf8');
      const { keys, errors } = extractRuntimeKeys(dir);
      expect(errors).toEqual([]);
      expect(keys.map((k) => k.key)).toEqual(['Nested']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Sanity check that the module's TypeScript import actually resolves the compiler API used above
// (guards against a broken re-export making the rest of this file pass vacuously).
describe('module wiring', () => {
  it('ts.createSourceFile is available', () => {
    expect(typeof ts.createSourceFile).toBe('function');
  });
});

describe('l10n binding resolution', () => {
  /**
  This is the form the previous, text-matching extractor lost without a word: the string reached
  neither the bundle nor the error report, so `l10n:check` stayed green while the UI went English.
  */
  it('extracts through an aliased named import', () => {
    withVerbatimSourceFile(
      "import { l10n as i18n } from 'vscode';\ni18n.t('Aliased');\n",
      (dir) => {
        const { keys, errors } = extractRuntimeKeys(dir);
        expect(errors).toEqual([]);
        expect(keys.map((k) => k.key)).toEqual(['Aliased']);
      },
    );
  });

  it('extracts through a plain named import', () => {
    withVerbatimSourceFile("import { l10n } from 'vscode';\nl10n.t('Named');\n", (dir) => {
      const { keys, errors } = extractRuntimeKeys(dir);
      expect(errors).toEqual([]);
      expect(keys.map((k) => k.key)).toEqual(['Named']);
    });
  });

  /**
  A binding used other than as the receiver of a direct `.t(...)` call must fail loudly rather than
  be skipped — the whole point of the change is that an unextractable form is reported, not lost.
  */
  it('reports an error when l10n is aliased to a bare local', () => {
    const source = "import { l10n } from 'vscode';\nconst t = l10n.t;\nvoid t('Indirect');\n";
    withVerbatimSourceFile(source, (dir) => {
      const { keys, errors } = extractRuntimeKeys(dir);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.detail).toContain('receiver of a direct');
      expect(keys).toEqual([]);
    });
  });

  /**
  An identifier merely named `l10n` but not imported from `vscode` is not our call.
  */
  it('ignores an l10n-looking identifier that is not the vscode import', () => {
    withVerbatimSourceFile(
      "const l10n = { t: (s: string) => s };\nl10n.t('Not ours');\n",
      (dir) => {
        const { keys, errors } = extractRuntimeKeys(dir);
        expect(errors).toEqual([]);
        expect(keys).toEqual([]);
      },
    );
  });
});
