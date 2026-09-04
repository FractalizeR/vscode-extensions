/**
 * `HighlightSpec` → `vscode.FileDecoration`, for the color/badge carrier (docs/plans/projects-tree/
 * 03-tree-view.md, package 03-B). Applied only to nodes with an explicit `color` or `badge`: a
 * `HighlightSpec` carrying only `sortWeight`, only `icon`, only `description`, or only
 * `labelHighlight` must not reach `FileDecoration` — none of those fields map onto its `badge`,
 * `tooltip` or `color`, and a decoration with none of those three throws and is dropped by the
 * platform (api-facts.md, fact 7).
 *
 * A decoration propagates to its ancestors only when its rule sets `HighlightSpec.propagate`
 * (`03-tree-view.md`, "Решения, изменённые при реализации"). What fact 9 asks this module to
 * signal turns out to already exist: firing `onDidChangeFileDecorations` for the *changed node's
 * own* URI is sufficient for VS Code to pick a propagating decoration up on an ancestor.
 * `getDecoration`'s `includeChildren` scan folds in any cached descendant whose data has `bubble`
 * (the extension's `propagate`, api-facts.md fact 62) set, and `affectsResource` — backed by
 * `TernarySearchTree.hasElementOrSubtree` — is true for *every* on-disk ancestor of a fired URI,
 * not only the fired one. So `update` below needs no ancestor-URI computation of its own: the
 * per-node signal it already sends (unconditionally, propagate or not) is the one fact 9 requires.
 * An earlier revision of this module computed and fired an explicit ancestor chain anyway; removed
 * because it changed no observable behavior (fact 62) while making the decorations service query
 * every ancestor and get back `undefined` for a bubble it already knew about — the class of
 * no-effect work round 06 flagged the first time this file carried an ancestor signal.
 *
 * This also means the "climbs only within the configured root" boundary a rule author might expect
 * from `propagate` is not something this module can promise or enforce: VS Code's own bubble climbs
 * the literal filesystem hierarchy, with no concept of "our root" at all. If a configured root sits
 * inside a larger open workspace, `propagate: true` will surface in built-in Explorer folders above
 * that root that ProjectsTree never claimed to manage — the price of opting a rule into propagation
 * at all (fact 8), not a defect in this file.
 *
 * `buildDecorationSpec`/`isBadgeWithinPlatformLimit` are exported for this directory's own tests,
 * not through `decorations/index.ts` — nothing outside `decorations/` needs the raw spec, only the
 * class below (docs/plans/projects-tree/review-05/REPORT.md, M5: an export reachable only from
 * tests is exactly the defect class that report names).
 */
import * as vscode from 'vscode';
import type { HighlightSpec } from '../../projects/classification/index.js';
import { isRootGroupNode, type TreeElement } from '../tree-view/root-group.js';

/**
VS Code counts a `badge` in Unicode code points, not UTF-16 units (`extHostTypes.ts`'s
`nextCharLength`, applied twice — api-facts.md, fact 7): a single surrogate-pair emoji is one
"character" to it. Spreading a string iterates by code point, which is what this counts — matching
`projects/classification/validation.ts`'s `validateHighlight` exactly, so this adapter cannot
reintroduce the UTF-16-vs-code-point mismatch round 05 found there (codex-13). The core already
rejects an over-long badge before a rule reaches the tree; this is a second, independent guard for
whatever `HighlightSpec` this module is handed regardless of whether it went through that
validation.
*/
export function isBadgeWithinPlatformLimit(badge: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- code-point count, see above.
  return [...badge].length <= 2;
}

/**
Plain-data shape of what a decoration will carry — deliberately *not* `vscode.FileDecoration`
itself. The `@types/vscode` package pinned to this project's 1.85 compatibility floor declares
`ThemeColor` with a constructor only (`node_modules/.pnpm/@types+vscode@1.85.0/.../index.d.ts:900-
907`) — no public `id` field; that field exists only from 1.134.0 on (api-facts.md, row 43, the
newer-source quote it was built from — corrected by the plan owner after this module first tried to
read it back). Keeping the color as a plain `colorId: string` here means `buildDecorationSpec`
never touches `vscode.ThemeColor` at all, and both it and every equality check on its output stay
fully assertable by value in a test — a `vscode.FileDecoration`'s `.color` cannot be, at this
floor, without introspecting a type the compiler does not expose.
*/
export interface DecorationSpec {
  readonly badge?: string | undefined;
  readonly tooltip?: string | undefined;
  readonly colorId?: string | undefined;
  readonly propagate?: boolean | undefined;
}

/**
`undefined` when neither `color` nor `badge` is set — the caller must not construct a
`FileDecoration` at all in that case (fact 7: empty decorations throw and are dropped, silently,
with only a log line the extension never sees — api-facts.md, fact 7's `extHostDecorations.ts`
excerpt). An over-limit badge is treated as absent rather than truncated: silently reshaping a rule
author's badge is a worse surprise than dropping it, and dropping it here still lets `color` through
instead of losing the whole decoration the way an uncaught platform throw would.

An empty or whitespace-only badge (`''`, `' '`) is likewise treated as absent, not passed through
(review-06, codex-05): VS Code's own emptiness check (fact 7's `!d.badge`) is falsy for `''`, so a
decoration that also sets `color`/`tooltip` would otherwise reach the platform whole while the badge
slot renders nothing visible — this module's own guard, same as `validateHighlight`'s in
`projects/classification/validation.ts`, since a `HighlightSpec` reaching here did not necessarily
go through that validation (see this file's own doc comment on why `buildDecorationSpec` re-checks
the badge length independently).

`tooltip` is `HighlightSpec.description`: the core defines no separate tooltip field, and
`description`'s own text is exactly what a hover over the color/badge should say.
*/
export function buildDecorationSpec(
  highlight: HighlightSpec | undefined,
): DecorationSpec | undefined {
  if (highlight === undefined) return undefined;
  const badge =
    highlight.badge !== undefined &&
    highlight.badge.trim().length > 0 &&
    isBadgeWithinPlatformLimit(highlight.badge)
      ? highlight.badge
      : undefined;
  if (badge === undefined && highlight.color === undefined) return undefined;
  return {
    badge,
    tooltip: highlight.description,
    colorId: highlight.color,
    propagate: highlight.propagate === true ? true : undefined,
  };
}

// The one place a `DecorationSpec` becomes a real `vscode.FileDecoration` — never introspected
// afterwards (see `DecorationSpec`'s doc comment for why).
function toFileDecoration(spec: DecorationSpec): vscode.FileDecoration {
  const color = spec.colorId === undefined ? undefined : new vscode.ThemeColor(spec.colorId);
  const decoration = new vscode.FileDecoration(spec.badge, spec.tooltip, color);
  // Left `undefined` (not `false`) when the rule did not ask for it, matching how every other
  // field here is only ever set when present — `FileDecoration.propagate` itself already defaults
  // to falsy when absent.
  if (spec.propagate === true) decoration.propagate = true;
  return decoration;
}

interface CollectedEntry {
  readonly key: string;
  readonly uri: vscode.Uri;
  readonly spec: DecorationSpec | undefined;
}

/**
Walks the tree once, pairing every `ClassifiedNode` with its own decoration spec (if any). A `RootGroupNode` contributes no entry of its own
— it has no `resourceUri` (docs/plans/projects-tree/00-overview.md, "Корень — контейнер, а не
узел") — but its children are still walked, so grouping by root changes nothing about which URIs
carry a decoration.

`seenKeys` gives every URI at most one entry (review-06, codex-09/claude-05): the core keys a node
by `rootId` + path (`NodeKey`, `tree-view/registry.ts`), because two configured roots can overlap on
disk, but `provideFileDecoration` is handed only a `vscode.Uri` (fact 8) — the platform gives this
provider no way to say *which* node a URI's decoration is for, so two nodes that share an absolute
path can never carry independent decorations at this boundary; that is a platform limitation, not a
gap in this module. The decision here is first-write-wins in `roots`/discovery order: the first
node to reach a given URI (its own configured root's position, since `collect` walks `elements` —
`buildTopLevel`'s per-root groups, in `roots` order — depth-first) claims that URI's decoration, and
every later node at the same path is walked (its own children may still have distinct paths) but
contributes no decoration of its own. Rejected alternative: merge the two `HighlightSpec`s
field-by-field — rejected because "which root's color wins when both set one" has no non-arbitrary
answer either, and a silent merge would look like a real per-node decoration when it structurally
cannot be one.
*/
function collect(
  elements: readonly TreeElement[],
  out: CollectedEntry[],
  seenKeys: Set<string>,
): void {
  for (const element of elements) {
    if (isRootGroupNode(element)) {
      collect(element.children, out, seenKeys);
      continue;
    }
    const uri = vscode.Uri.file(element.facts.absolutePath);
    const key = uri.toString();
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      out.push({ key, uri, spec: buildDecorationSpec(element.verdict.highlight.value) });
    }
    collect(element.children, out, seenKeys);
  }
}

/**
 * Global `FileDecorationProvider` (api-facts.md, fact 8: registration carries no view id, so
 * decorations from this provider also render in the Explorer). `update` is the only write path —
 * called with the tree's current top level after every refresh — and diffs against the previous
 * call to signal every URI whose decoration changed. That per-node signal, sent regardless of
 * `propagate`, is also everything a propagating decoration needs to reach an ancestor (this file's
 * module doc comment, fact 62) — no separate ancestor-URI signal exists in this class.
 */
export class HighlightDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  #state = new Map<string, CollectedEntry>();
  #decorations = new Map<string, vscode.FileDecoration>();
  readonly #emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();

  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> =
    this.#emitter.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    return this.#decorations.get(uri.toString());
  }

  update(elements: readonly TreeElement[]): void {
    const entries: CollectedEntry[] = [];
    collect(elements, entries, new Set<string>());
    const nextState = new Map(entries.map((entry) => [entry.key, entry]));

    const toSignal = new Map<string, vscode.Uri>();
    const allKeys = new Set([...this.#state.keys(), ...nextState.keys()]);
    for (const key of allKeys) {
      const previous = this.#state.get(key);
      const next = nextState.get(key);
      if (JSON.stringify(previous?.spec) === JSON.stringify(next?.spec)) continue;
      const uri = next?.uri ?? previous?.uri;
      if (uri === undefined) continue;
      // Sent for every changed node, `propagate` or not — this is also the paired half of the
      // flag `toFileDecoration` sets: firing the changed node's own URI is what fact 9 requires,
      // and it is already sufficient for VS Code to re-evaluate any ancestor (this file's module
      // doc comment, fact 62). A separate ancestor-URI signal is not computed here on purpose.
      toSignal.set(key, uri);
    }

    this.#state = nextState;
    this.#decorations = new Map(
      entries.flatMap((entry) =>
        entry.spec ? ([[entry.key, toFileDecoration(entry.spec)]] as const) : [],
      ),
    );

    // Iterator#toArray() needs a newer lib than this project's ES2022 target (see sort.ts's
    // toSorted() comment for the same tradeoff).
    // eslint-disable-next-line unicorn/prefer-iterator-to-array
    if (toSignal.size > 0) this.#emitter.fire([...toSignal.values()]);
  }

  dispose(): void {
    this.#emitter.dispose();
  }
}
