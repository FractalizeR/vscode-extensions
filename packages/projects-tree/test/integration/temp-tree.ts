/**
 * Not itself a test — a helper shared by the suites in this directory (mocha's `files` glob in
 * `.vscode-test.mjs` only matches `*.test.js`, so this file is never picked up as a suite of its
 * own). Every test here classifies real directories on a real filesystem rather than a fake
 * `FileSystemReader`, since the fake is what the vitest unit tests already cover — the point of
 * this suite is exercising the real `node:fs` + real `vscode` combination together.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
A directory carrying `DEFAULT_RULES`'s repo marker (`src/projects/classification/defaults.ts`,
rule `repo-marker`), classifying it `project: true`.
*/
export async function makeProjectDir(parentDir: string, name: string): Promise<string> {
  const dir = path.join(parentDir, name);
  await mkdir(path.join(dir, '.git'), { recursive: true });
  return dir;
}

export async function makeTempRoot(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), `${prefix}-`));
}

/**
Recursively removes `dir` — used both to tear down a temp root and, in the resilience suite, to
simulate a branch vanishing from disk mid-session.
*/
export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
