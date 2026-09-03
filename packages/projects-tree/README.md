# Projects Tree

A VS Code extension that shows a tree of related project checkouts on disk,
for jumping between them without leaving the editor.

## Status

Early. The tree is contributed and works: configure `projectsTree.roots`,
and every project found underneath them shows up, classified by rules rather
than by a hardcoded `.git` check. Actions beyond "open in a new window",
the onboarding walkthrough and the visual rules editor are not built yet.

## Configuration

| Setting                      | What it does                                                                |
| ---------------------------- | --------------------------------------------------------------------------- |
| `projectsTree.roots`         | Root folders to scan. An absolute path, or `{ "path": "…", "label": "…" }`. |
| `projectsTree.showRootNodes` | Whether each root gets its own group node (`auto` / `always` / `never`).    |
| `projectsTree.location`      | Where the tree lives: `activityBar`, `explorer`, or `none`.                 |

`roots` is declared `scope: machine`, so a repository's own
`.vscode/settings.json` cannot point the scan at folders of its choosing.

## Limitations

**Rules are not carried between machines by Settings Sync.** Rules and
actions live in `projects-tree.rules.json` inside the extension's global
storage directory, not in `settings.json` — a recursive rule condition
cannot be expressed as a settings schema at all, and a file in global
storage cannot be overridden by a repository you happen to open. Settings
Sync synchronizes settings, not extension storage files, so the rules file
stays on the machine that wrote it, and has to be copied by hand.

**Highlighting is best-effort by design.** A highlighted node is shown
through three carriers — an emphasized label, a color and a badge — and
none of them is unconditional. The color and the badge are file
decorations, which VS Code renders globally: they also appear in the
Explorer, the badge shares its slot with git's, and a user who turns
`explorer.decorations.colors` or `explorer.decorations.badges` off turns
them off here too. The label emphasis occupies the same channel VS Code
uses to highlight tree-search matches, so a filtered tree will not
highlight the match on an already-highlighted node.

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
