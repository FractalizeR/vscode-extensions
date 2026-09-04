# AGENTS.md

Canon for agents working in this repository. Rationale for the rules below lives in
`docs/architecture.md`; plans live in `docs/plans/**` and are the source of requirements — read
them. Edit a plan only to record a decision that changed deliberately (a review outcome, a user
decision); never to conform it to already-written code or to drop an inconvenient requirement.

## Layout

Current: `extension.ts` plus `projects/{classification,discovery,actions}/` (the core) and
`editor/{tree-view,decorations,commands,configuration,context-keys,rules}/` (the VS Code adapter).
Two of those are not in the target layout below and are named here instead of being discovered by
reading the tree: `editor/context-keys/` (the `when`-clause keys this extension sets) and
`editor/rules/` (reading and writing the canonical rules file on disk — the adapter half of
`projects/classification/rules-file.ts`, which may not touch the filesystem). Inside
`editor/commands/`, `actions/` holds the execution engine (runner, registry, one executor per
`ActionSpec` kind) while the files beside it register commands by id. Integration tests live
outside `src/`, in `packages/projects-tree/test/integration/`. Still absent from the target layout
below: `editor/onboarding/` (stage 05) and `editor/rules-editor/` (stage 06).

Target layout, introduced incrementally by `docs/plans/projects-tree/02-core.md` and
`03-tree-view.md` (do not create these directories ahead of the stage that introduces them):

```
packages/projects-tree/src/
  extension.ts   — entry point: builds the object graph, registers contributions
  projects/      — core, subject "projects on disk"
    classification/  — conditions, verdict, rule engine
    discovery/        — filesystem traversal, cancellation, child-fetch strategies
    actions/           — action model, rendering, quoting
  editor/        — VS Code adapter (delivery)
    tree-view/  decorations/  commands/  onboarding/  rules-editor/
```

`src/projects/**` must not import `vscode`. This is a machine-checked boundary
(`dependency-cruiser`, rule `no-vscode-in-core`); do not add an import that violates it, and do not
weaken the rule to make one pass.

## Validation

`pnpm check` is the full validation command. Run it before considering any change done. Its
current steps, in order:

1. `format:check` — Prettier
2. `typecheck` — includes the webview package
3. `lint` — ESLint
4. `depcruise` — architectural boundaries
5. `depcruise:negative` — intentional violator fixtures must fail their rule
6. `knip` — dead code and unused dependencies
7. `test` — vitest
8. `l10n:check` — every English string has a Russian counterpart, in both the manifest
   (`package.nls*.json`) and the runtime (`l10n/bundle.l10n*.json`) channel
9. `schema:check` — `rules.schema.json` compiles as a self-contained JSON Schema

The package that introduces a new class of check adds it to this list in the same change. Do not
add a check to CI or to a package script without also wiring it into `pnpm check`, and do not treat
a check as covered by `pnpm check` unless it runs there. This list is machine-checked against the
actual `check` chain (`tools/check-chain.test.ts`) — it drifted once already, `schema:check` having
been added to the chain without being written down here.

`test:integration` runs against the pinned `engines.vscode` floor (`1.85.0`) by default — the
version every `api-facts.md` decision is staked on — set in `.vscode-test.mjs`. Override locally
with `VSCODE_TEST_VERSION=<version>` (e.g. `stable`) to check current stable without editing the
config. CI runs the pinned floor only, not a matrix: the editor download is cached per version, and
a second version costs a second download and boot for a class of regression this project has not
needed yet.

`tools/check-vsix-contents.ts` cannot join `pnpm check` — it inspects a built `.vsix`, which
`pnpm check` does not produce. It runs in CI instead, in both the `check` job (right after the
packaging step, so a stale allowlist fails a pull request) and `publish.yml` (before a release).
Adding a shipped file means adding it to that allowlist in the same change.

Integration tests (`@vscode/test-cli`) require a running editor and stay out of `pnpm check` for
that reason; they run in their own CI job instead — `pnpm --filter projects-tree test:integration`
locally, the `integration-test` job in CI, which needs `xvfb-run -a` on Linux
(`docs/plans/projects-tree/api-facts.md`, fact 55). Their tsconfig is `packages/projects-tree/test/
tsconfig.json`, named so that ESLint's `projectService` finds it by walking up from each test file;
renaming it to `tsconfig.test.json` makes the whole test tree unlintable.

`@vscode/test-electron` is a direct devDependency of `packages/projects-tree` and is listed in
`knip.json`'s `ignoreDependencies`. It looks unused — nothing imports it by name — but
`@vscode/test-cli` resolves it at run time from the extension package's own directory, so removing
it makes `test:integration` fail with `Can't resolve '@vscode/test-electron'`. Do not "clean it
up"; knip cannot see a resolution another tool performs.

## api-facts.md

No decision may rely on a claim about the VS Code API that is not a row in
`docs/plans/projects-tree/api-facts.md`. A new row is invalid without a verbatim quote of its
source; a reference to a file without a quote does not satisfy this rule.

## Language

Code, commit messages, identifiers, and documentation are in English. Extension UI is bilingual
(en + ru) through `package.nls.*` and `l10n` bundles — do not hardcode user-facing strings.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), scope by domain (e.g. `feat(rules):`,
`fix(metrics):`).

## Tooling vs. runtime Node version

`engines.node` (`.nvmrc`) governs the build/lint/test toolchain, currently Node 26. The extension
itself runs inside the editor's own Node — esbuild targets `node18` for the extension bundle
regardless of the toolchain version. Do not assume a toolchain-only Node feature is available at
runtime, and do not change the esbuild `target` to match `engines.node`.

## Prohibited

- Importing `vscode` from `src/projects/**`.
- Adding a check to CI without adding it to `pnpm check`.
- Stating a VS Code API behavior as a basis for a decision without a quoted row in
  `docs/plans/projects-tree/api-facts.md`.
- Editing files under `docs/plans/**` to conform the plan to already-written code, or to drop or
  weaken a requirement, rather than to record a deliberately changed decision.
