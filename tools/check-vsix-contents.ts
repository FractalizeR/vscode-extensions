#!/usr/bin/env node
// Fails the build if a packaged .vsix contains files outside an explicit allowlist.
// Inspects the actual built archive (not vsce's pre-package source listing), since
// `vsce ls` has no way to point at an already-built .vsix file.
import { execFileSync } from 'node:child_process';

// Two entries are added by vsce's packaging step itself and are not part of the
// extension payload; every other top-level entry must be under `extension/`.
const PACKAGING_METADATA = new Set(['extension.vsixmanifest', '[Content_Types].xml']);

// vsce normalizes README.md -> readme.md and LICENSE -> LICENSE.txt when packaging.
const ALLOWLIST: readonly string[] = [
  'package.json',
  'readme.md',
  'LICENSE.txt',
  'l10n/bundle.l10n.json',
  'dist/extension.js',
  'schemas/rules.schema.json',
  'package.nls.json',
  'media/activity-icon.svg',
];

function sortedCopy(values: readonly string[]): string[] {
  // toSorted() would avoid the copy-then-sort dance, but it needs lib ES2023+;
  // the project's tsconfig targets ES2022 and is out of scope for this file.
  // eslint-disable-next-line unicorn/no-array-sort
  return [...values].sort((a, b) => a.localeCompare(b));
}

function readArchiveEntries(vsix: string): string[] {
  let output: string;
  try {
    output = execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8' });
  } catch (error: unknown) {
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout) : undefined;
    console.error(`Failed to list contents of ${vsix}:`);
    console.error(stdout ?? (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function main(): void {
  const vsix = process.argv[2];
  if (!vsix) {
    console.error('Usage: node tools/check-vsix-contents.ts <path-to-vsix>');
    process.exit(1);
  }

  const entries = readArchiveEntries(vsix);

  const unknownTopLevel = entries.filter(
    (entry) => !entry.startsWith('extension/') && !PACKAGING_METADATA.has(entry),
  );

  const actual = sortedCopy(
    entries
      .filter((entry) => entry.startsWith('extension/'))
      .map((entry) => entry.slice('extension/'.length)),
  );
  const expected = sortedCopy(ALLOWLIST);

  const unexpected = actual.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !actual.includes(file));

  if (unknownTopLevel.length > 0 || unexpected.length > 0 || missing.length > 0) {
    if (unknownTopLevel.length > 0) {
      console.error('Unexpected top-level archive entries (outside extension/ payload):');
      for (const entry of unknownTopLevel) console.error(`  + ${entry}`);
    }
    if (unexpected.length > 0) {
      console.error('Unexpected files in .vsix payload (not in allowlist):');
      for (const file of unexpected) console.error(`  + ${file}`);
    }
    if (missing.length > 0) {
      console.error('Expected files missing from .vsix payload:');
      for (const file of missing) console.error(`  - ${file}`);
    }
    process.exit(1);
  }

  console.log(`OK: ${vsix} payload matches the allowlist (${String(actual.length)} files).`);
}

main();
