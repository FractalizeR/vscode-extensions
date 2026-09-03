// Config for `@vscode/test-cli` (docs/plans/projects-tree/api-facts.md, fact 53). `vscode-test`
// looks for this file relative to the current working directory, so `test:integration` (see
// AGENTS.md report) must run with `packages/projects-tree` as its cwd — e.g.
// `pnpm --filter projects-tree run test:integration`.
import nodeOs from 'node:os';
import nodePath from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// The editor opens a Unix domain socket inside its --user-data-dir, and the kernel caps that path
// at 103 characters. The default lands it under this package (`.vscode-test/user-data/`), which
// already exceeds the cap when the repository sits at any realistic checkout depth — the editor
// then dies at startup with `listen EINVAL`, before a single test runs. Keeping the directory
// short and outside the repo is the only fix that does not depend on where someone cloned this.
// `/tmp` over `os.tmpdir()` on POSIX deliberately: macOS's tmpdir is itself a long
// `/var/folders/…` path, which is what the cap is being blown by in the first place.
const userDataDir =
  process.platform === 'win32'
    ? nodePath.join(nodeOs.tmpdir(), 'projects-tree-vscode-test')
    : '/tmp/pt-vscode-test';

export default defineConfig({
  // tsconfig.test.json emits here (rootDir "." -> outDir "out", mirroring test/ and src/).
  files: 'out/test/**/*.test.js',
  // Defaults to this file's own directory, stated explicitly so the intent survives a future move
  // of this config file.
  extensionDevelopmentPath: '.',
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
