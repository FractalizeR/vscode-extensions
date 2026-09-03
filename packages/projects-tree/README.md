# Projects Tree

A VS Code extension that shows a tree of related project checkouts on disk,
for jumping between them without leaving the editor.

## Status

Early scaffold. No views or commands are contributed yet — this package
currently ships an empty `activate`/`deactivate` stub while the surrounding
tooling (build, packaging, CI) is put in place.

`activationEvents` is empty on purpose: no contribution requires activation
yet. It will gain entries alongside the view/command contributions planned
for stage 03.

## Development

```bash
pnpm --filter projects-tree build        # dev bundle, with sourcemap
pnpm --filter projects-tree build:prod   # production bundle, minified
pnpm --filter projects-tree typecheck
pnpm --filter projects-tree package      # builds and produces a .vsix
```

The extension bundle targets Node 18, matching the Node runtime of the
lowest supported editor version (`engines.vscode` = `^1.85.0`) — not the
Node 26 used to build and test this repository.

## License

MIT — see [LICENSE](./LICENSE).
