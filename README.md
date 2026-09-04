# vscode-extensions

My extensions for VS Code. A monorepo built with pnpm workspaces; each extension lives under
`packages/`.

## Packages

- [`packages/projects-tree`](packages/projects-tree) — ProjectsTree. Currently a scaffold: it
  installs and activates but contributes no UI yet.

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
