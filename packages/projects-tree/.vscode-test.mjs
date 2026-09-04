// Config for `@vscode/test-cli` (docs/plans/projects-tree/api-facts.md, fact 53). `vscode-test`
// looks for this file relative to the current working directory, so `test:integration` (see
// AGENTS.md report) must run with `packages/projects-tree` as its cwd — e.g.
// `pnpm --filter projects-tree run test:integration`.
import nodeCrypto from 'node:crypto';
import nodeOs from 'node:os';
import nodePath from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// The editor opens a Unix domain socket inside its --user-data-dir, and the kernel caps that path
// at 103 characters — verified empirically against the locally cached 1.136.1: pointing
// `--user-data-dir` at an over-long path prints `WARNING: IPC handle
// ".../1.13-main.sock" is longer than 103 chars, try a shorter --user-data-dir` and then fails
// startup with `Error: listen EINVAL: invalid argument .../1.13-main.sock` before a single test
// runs — the socket file itself is `<user-data-dir>/1.13-main.sock` (15 characters), leaving
// `--user-data-dir` a budget of 88. The default lands it under this package
// (`.vscode-test/user-data/`), which already exceeds the cap when the repository sits at any
// realistic checkout depth. `.vscode-test.mjs` keeps the directory short and outside the repo.
//
// A single fixed name outside the repo trades one problem for another: every checkout on the
// machine, and every user, shares one editor profile — two concurrent runs (two checkouts, or two
// parallel CI jobs) fight over one `--user-data-dir`, and on a multi-user machine the first
// owner's file permissions lock everyone else out. The directory name below is therefore derived
// from the checkout path and the user, not fixed: distinct checkouts (or distinct users on a
// shared machine) get distinct, deterministic directories — a rerun of the same checkout by the
// same user reuses its own directory rather than accumulating a fresh one in `/tmp` every time —
// while staying at a fixed, short length regardless of how deep the checkout path itself is.
function userDataDirId() {
  const material = `${process.cwd()}:${process.getuid?.() ?? process.env.USERNAME ?? ''}`;
  return nodeCrypto.createHash('sha1').update(material).digest('hex').slice(0, 12);
}

// `/tmp` over `os.tmpdir()` on POSIX deliberately: macOS's tmpdir is itself a long
// `/var/folders/…` path, which is what the cap is being blown by in the first place. Windows'
// `os.tmpdir()` is already short and per-user, so no such substitution is needed there.
const userDataDir =
  process.platform === 'win32'
    ? nodePath.join(nodeOs.tmpdir(), `pt-vscode-test-${userDataDirId()}`)
    : `/tmp/pt-${userDataDirId()}`;

// Pinned to `engines.vscode`'s floor (api-facts.md, fact 35), not left to resolve to whatever
// `@vscode/test-cli` calls "stable" — its own README documents that omitting `version` "defaults
// to stable" (`@vscode/test-cli` README, sample config comment: "Optional: Version to use, same as
// the API above, defaults to stable"), which is a moving target that drifts away from the floor
// this whole `api-facts.md` discipline exists to defend, and was doing exactly that (1.136.1
// locally against a declared `^1.85.0` floor — round 06 review, codex-08). A floor+stable matrix
// was considered and rejected for now: `@vscode/test-electron`'s download is cached per OS (not
// per version) in CI, so each additional pinned version this config runs downloads and boots a
// second real editor on every cache-cold run — real CI time for a benefit (catching a
// stable-only regression) this project has not yet needed, versus the floor, which is what every
// decision in `api-facts.md` is actually staked on. Override locally with `VSCODE_TEST_VERSION`
// (e.g. `VSCODE_TEST_VERSION=stable`) to check the floor's assumptions against current stable
// without editing this file.
const version = process.env.VSCODE_TEST_VERSION ?? '1.85.0';

export default defineConfig({
  // test/tsconfig.json emits here (rootDir "." -> outDir "out", mirroring test/ and src/). It is
  // named tsconfig.json, not tsconfig.test.json, so ESLint's projectService finds it by walking
  // up from each test file — see AGENTS.md.
  files: 'out/test/**/*.test.js',
  // Defaults to this file's own directory, stated explicitly so the intent survives a future move
  // of this config file.
  extensionDevelopmentPath: '.',
  version,
  launchArgs: ['--user-data-dir', userDataDir],
  mocha: {
    // `suite`/`test` (Mocha's TDD interface), matching the convention VS Code's own extension
    // generator uses for extension tests — chosen over the default BDD `describe`/`it` so a
    // reader scanning file contents cannot mistake an integration test for one of the `describe`/
    // `it` unit tests vitest runs over `src/**`.
    ui: 'tdd',
    // A full run walks temporary directory trees and boots a real editor; the default 2s Mocha
    // timeout is tuned for in-process unit tests, not this.
    timeout: 20_000,
  },
});
