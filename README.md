# vscode-extensions

My extensions for VS Code. A monorepo built with pnpm workspaces; each extension lives under
`packages/`.

## Packages

- [`packages/projects-tree`](packages/projects-tree) — ProjectsTree. A tree of the projects found
  by walking one or more root folders on disk. What counts as a project is decided by rules, not by
  a hardcoded `.git` check; nodes can be highlighted, hidden, and acted on (open in a window, run a
  command in a terminal, launch an external editor, open a URI, invoke a VS Code command). The tree
  lives in its own Activity Bar container or inside the Explorer, or nowhere at all — in which case
  "Open Project…" is the way in. UI is bilingual (en + ru).

  Named limitations, all deliberate:
  - **The rules file does not sync between machines.** It lives in the extension's global storage,
    not in `settings.json`, because a recursive condition schema cannot be expressed in a setting
    and because a foreign repository's `.vscode/settings.json` must not be able to redirect the
    walk or supply a command. Settings Sync does not carry that file; export/import is the answer.
  - **Rule edits are picked up on the next refresh**, not instantly — no file watcher yet.
  - **A command sent to a terminal is inserted, not executed**, unless the action opts in. The user
    sees the substituted path and presses Enter.
  - **A `.cmd`/`.bat` target is refused for `process` actions.** On Windows those do not launch
    without a shell at all, so an argv array does not protect them — declare such a target as a
    `terminal` action with an explicit shell instead.
  - **`roots`, `maxDepth` and `defaultAction` are `machine`-scoped**, which means user _or remote_
    settings. In a remote window they arrive from the remote machine, so the first terminal,
    process or VS Code-command action there asks for confirmation once.
  - **A highlight with `propagate` climbs beyond the configured root.** VS Code computes ancestor
    decorations by literal path containment and knows nothing about this extension's roots, so the
    badge can surface on Explorer folders above the root. That is why it is off unless a rule asks
    for it.

## Development

`pnpm check` is the full validation command (formatting, typecheck, lint, architectural
boundaries, dead code, unit tests) — run it before considering any change done.

Design decisions and the requirements each package implements live under
[`docs/plans`](docs/plans); the canon agents work from is [`AGENTS.md`](AGENTS.md).

## Cloning on Windows

`CLAUDE.md` in the repository root is a symlink to `AGENTS.md`. Git on Windows only creates a real
symlink at checkout if `core.symlinks` is enabled — otherwise `CLAUDE.md` comes down as a plain
text file containing the path `AGENTS.md` instead of the canon's content. To get a real symlink,
set `git config --global core.symlinks true` before cloning (on Windows this also needs permission
to create symlinks — Developer Mode or an elevated shell), then re-checkout the file if you already
cloned without it.
