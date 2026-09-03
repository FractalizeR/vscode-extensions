# AGENTS.md

Canon for agents working in this repository. Rationale for the rules below lives in
`docs/architecture.md`; plans live in `docs/plans/**` and are the source of requirements — read
them. Edit a plan only to record a decision that changed deliberately (a review outcome, a user
decision); never to conform it to already-written code or to drop an inconvenient requirement.

## Layout

Current: `packages/projects-tree/src/extension.ts` only — entry point, builds the object graph,
registers contributions.

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

Integration tests (`@vscode/test-cli`) require a running editor and stay out of `pnpm check` for
that reason; they run in their own CI job instead. Introduced by
`docs/plans/projects-tree/03-tree-view.md` — the `test:integration` script and that job do not
exist yet.

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
