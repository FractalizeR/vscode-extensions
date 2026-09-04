import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rule } from '../../projects/classification/index.js';
import { RULES_FILE_NAME, rulesFilePath } from './canonical-rules.js';
import { readRulesFileForEdit, writeRulesFile } from './store.js';

// A no-op passthrough by default; the "landed during its own temp-file write" test below points
// this at a real filesystem side effect to simulate a competing writer landing in the gap
// `writeRulesFile`'s own `writeFile` await opens up (R07-RULES-LOST-UPDATE). `vi.spyOn` cannot
// intercept a Node builtin's named export directly ("Module namespace is not configurable in
// ESM"), so the module itself is mocked instead, with `importOriginal` keeping every other export
// real.
const writeFileHook: { onWriteFile: ((targetPath: string) => Promise<void>) | undefined } = {
  onWriteFile: undefined,
};

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await actual.writeFile(...args);
      const [target] = args;
      // `writeRulesFile` only ever passes a string path — the `Buffer | URL | FileHandle` branches
      // of `PathLike` are unreachable in this codebase's own writer, so the fallback below is never
      // exercised; it only exists to satisfy the real `writeFile` signature this mock stands in for.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const targetPath = typeof target === 'string' ? target : String(target);
      if (writeFileHook.onWriteFile !== undefined) await writeFileHook.onWriteFile(targetPath);
    },
  };
});

const state: { storageDir: string } = { storageDir: '' };

beforeEach(async () => {
  state.storageDir = await mkdtemp(nodePath.join(tmpdir(), 'projects-tree-rules-store-'));
});

afterEach(async () => {
  await rm(state.storageDir, { recursive: true, force: true });
});

function location(): { globalStorageUri: { fsPath: string } } {
  return { globalStorageUri: { fsPath: state.storageDir } };
}

const sampleRule: Rule = {
  id: 'sample',
  when: { kind: 'nameMatches', pattern: '^x$' },
  verdict: { skip: true },
};

describe('readRulesFileForEdit', () => {
  it('reports mtimeMs: undefined and no rules when the file does not exist', async () => {
    const { file, diagnostics } = await readRulesFileForEdit(location(), []);
    expect(diagnostics).toEqual([]);
    expect(file).toEqual({ version: 1, rules: [], actions: [], mtimeMs: undefined });
  });

  it('reads back the exact user rules on disk, not merged with any defaults', async () => {
    await writeFile(
      rulesFilePath(location()),
      JSON.stringify({
        version: 1,
        rules: [
          // eslint-disable-next-line unicorn/no-thenable -- on-disk key, see rules-file.ts.
          { id: 'only-mine', when: { kind: 'nameMatches', pattern: '^x$' }, then: { skip: true } },
        ],
      }),
      'utf8',
    );

    const { file, diagnostics } = await readRulesFileForEdit(location(), []);
    expect(diagnostics).toEqual([]);
    expect(file?.rules.map((rule) => rule.id)).toEqual(['only-mine']);
    expect(file?.mtimeMs).toEqual(expect.any(Number));
  });

  it('refuses to hand back a file for editing when it fails domain validation', async () => {
    await writeFile(
      rulesFilePath(location()),
      JSON.stringify({
        version: 1,
        rules: [
          // eslint-disable-next-line unicorn/no-thenable -- on-disk key, see rules-file.ts.
          { id: 'dup', when: { kind: 'nameMatches', pattern: 'a' }, then: {} },
          // eslint-disable-next-line unicorn/no-thenable -- on-disk key, see rules-file.ts.
          { id: 'dup', when: { kind: 'nameMatches', pattern: 'b' }, then: {} },
        ],
      }),
      'utf8',
    );

    const { file, diagnostics } = await readRulesFileForEdit(location(), []);
    expect(file).toBeUndefined();
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

describe('writeRulesFile', () => {
  it('creates the globalStorageUri directory when it does not exist yet (fact 34)', async () => {
    const missingDir = nodePath.join(state.storageDir, 'not-yet-created');
    const target = { globalStorageUri: { fsPath: missingDir } };

    const result = await writeRulesFile(
      target,
      { version: 1, rules: [sampleRule], actions: [] },
      undefined,
    );

    expect(result.ok).toBe(true);
    const content = await readFile(rulesFilePath(target), 'utf8');
    expect(JSON.parse(content)).toMatchObject({ rules: [{ id: 'sample' }] });
  });

  it('never writes DEFAULT_RULES into the file — only the rules it was given', async () => {
    const result = await writeRulesFile(
      location(),
      { version: 1, rules: [sampleRule], actions: [] },
      undefined,
    );
    expect(result.ok).toBe(true);

    const content = await readFile(rulesFilePath(location()), 'utf8');
    const parsed = JSON.parse(content) as { rules: { id: string }[] };
    expect(parsed.rules.map((rule) => rule.id)).toEqual(['sample']);
  });

  it('leaves no temp file behind after a successful write', async () => {
    await writeRulesFile(location(), { version: 1, rules: [sampleRule], actions: [] }, undefined);

    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(state.storageDir);
    expect(entries).toEqual([RULES_FILE_NAME]);
  });

  it('rejects a write whose expected mtime no longer matches the file on disk', async () => {
    const first = await writeRulesFile(
      location(),
      { version: 1, rules: [sampleRule], actions: [] },
      undefined,
    );
    expect(first.ok).toBe(true);

    // Simulate a second writer having touched the file after we read it: mtime moves without
    // this test needing a real second process or a filesystem-timer wait.
    const path = rulesFilePath(location());
    const future = new Date(Date.now() + 60_000);
    await utimes(path, future, future);

    const second = await writeRulesFile(
      location(),
      { version: 1, rules: [{ ...sampleRule, id: 'other' }], actions: [] },
      first.ok ? first.mtimeMs : undefined,
    );

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.diagnostic.message).toMatch(/changed on disk/);
    // The rejected write must not have touched the file — the original content survives.
    const content = JSON.parse(await readFile(path, 'utf8')) as { rules: { id: string }[] };
    expect(content.rules.map((rule) => rule.id)).toEqual(['sample']);
  });

  it('rejects a write that expected no file but one now exists', async () => {
    await writeFile(rulesFilePath(location()), JSON.stringify({ version: 1, rules: [] }), 'utf8');

    const result = await writeRulesFile(
      location(),
      { version: 1, rules: [sampleRule], actions: [] },
      undefined,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.message).toMatch(/created on disk/);
  });

  it('rejects a write that expected an existing file but it was deleted', async () => {
    const first = await writeRulesFile(
      location(),
      { version: 1, rules: [sampleRule], actions: [] },
      undefined,
    );
    expect(first.ok).toBe(true);
    await rm(rulesFilePath(location()));

    const second = await writeRulesFile(
      location(),
      { version: 1, rules: [sampleRule], actions: [] },
      first.ok ? first.mtimeMs : undefined,
    );

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.diagnostic.message).toMatch(/deleted from disk/);
  });

  /**
   * R07-RULES-LOST-UPDATE: the original write checked `mtime` once, then wrote the temp file and
   * `rename`d over the target with no second check — a write that landed on disk during the
   * `writeFile` await (the gap between the check and the swap) went undetected and was silently
   * clobbered by the `rename`. Simulating that arrival from inside a spied `writeFile` (rather than
   * a real second process, which this suite has no way to spin up) proves the re-`stat` immediately
   * before `rename` catches it. This is a narrowed window, not a closed one — see `writeRulesFile`'s
   * own doc comment for what the fix does not cover.
   */
  it('refuses to rename over a write that landed during its own temp-file write', async () => {
    const first = await writeRulesFile(
      location(),
      { version: 1, rules: [sampleRule], actions: [] },
      undefined,
    );
    expect(first.ok).toBe(true);
    const path = rulesFilePath(location());

    // Fires once, on the very next `writeFile` call (`writeRulesFile`'s own temp-file write below)
    // — a competing writer's `rename` landing in the gap that `writeFile` await opens up, exactly
    // the window `writeRulesFile`'s own doc comment names.
    writeFileHook.onWriteFile = async () => {
      writeFileHook.onWriteFile = undefined;
      const future = new Date(Date.now() + 60_000);
      await utimes(path, future, future);
    };

    try {
      const second = await writeRulesFile(
        location(),
        { version: 1, rules: [{ ...sampleRule, id: 'other' }], actions: [] },
        first.ok ? first.mtimeMs : undefined,
      );

      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.diagnostic.message).toMatch(/changed on disk/);
      const content = JSON.parse(await readFile(path, 'utf8')) as { rules: { id: string }[] };
      expect(content.rules.map((rule) => rule.id)).toEqual(['sample']);

      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(state.storageDir);
      expect(entries).toEqual([RULES_FILE_NAME]); // the temp file must be cleaned up, not orphaned
    } finally {
      writeFileHook.onWriteFile = undefined;
    }
  });

  it('round-trips through readRulesFileForEdit -> writeRulesFile -> readRulesFileForEdit', async () => {
    const write = await writeRulesFile(
      location(),
      { version: 1, rules: [sampleRule], actions: [] },
      undefined,
    );
    expect(write.ok).toBe(true);

    const { file } = await readRulesFileForEdit(location(), []);
    expect(file?.rules.map((rule) => rule.id)).toEqual(['sample']);
    expect(file?.mtimeMs).toEqual(write.ok ? write.mtimeMs : undefined);

    // A write based on exactly the mtime just read back succeeds — the happy path every command
    // handler relies on (read, then write with that same read's mtime).
    const second = await writeRulesFile(
      location(),
      { version: 1, rules: [...(file?.rules ?? []), { ...sampleRule, id: 'second' }], actions: [] },
      file?.mtimeMs,
    );
    expect(second.ok).toBe(true);
  });
});
