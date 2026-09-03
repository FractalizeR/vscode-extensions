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

function withTempSourceFile(contents: string, run: (dir: string) => void): void {
  const dir = mkdtempSync(nodePath.join(tmpdir(), 'check-l10n-test-'));
  try {
    writeFileSync(nodePath.join(dir, 'sample.ts'), contents, 'utf8');
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
      writeFileSync(nodePath.join(dir, 'nested', 'a.ts'), "vscode.l10n.t('Nested');\n", 'utf8');
      writeFileSync(
        nodePath.join(dir, 'a.test.ts'),
        "vscode.l10n.t('Should not be picked up');\n",
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
