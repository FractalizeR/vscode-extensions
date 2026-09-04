/**
 * `HighlightSpec` → `vscode.FileDecoration`, for the color/badge carrier (docs/plans/projects-tree/
 * 03-tree-view.md, package 03-B). Applied only to nodes with an explicit `color` or `badge`: a
 * `HighlightSpec` carrying only `sortWeight`, only `icon`, only `description`, or only
 * `labelHighlight` must not reach `FileDecoration` — none of those fields map onto its `badge`,
 * `tooltip` or `color`, and a decoration with none of those three throws and is dropped by the
 * platform (api-facts.md, fact 7).
 *
 * No decoration propagates to its ancestors — see `toFileDecoration` for why, and
 * `03-tree-view.md` for the decision. Consequently this module does not signal ancestor URIs
 * either: fact 9 requires that signal *for a propagating decoration*, and signalling for a
 * decoration that does not propagate is work with no observable effect, which no test could catch
 * the loss of. Both halves — the flag and the ancestor signal — return together when `propagate`
 * becomes a per-rule field.
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
  return { badge, tooltip: highlight.description, colorId: highlight.color };
}

// The one place a `DecorationSpec` becomes a real `vscode.FileDecoration` — never introspected
// afterwards (see `DecorationSpec`'s doc comment for why).
function toFileDecoration(spec: DecorationSpec): vscode.FileDecoration {
  const color = spec.colorId === undefined ? undefined : new vscode.ThemeColor(spec.colorId);
  // `propagate` is deliberately left off. Turning it on makes a highlight climb to a node's
  // ancestors, and this provider is global (fact 8) — so a badge asked for on one project would
  // also appear on the folders above it in the Explorer, where nothing about ProjectsTree was
  // requested and where the user cannot switch it off short of disabling file decorations
  // altogether. The plan describes ancestor propagation as a design property (03-B: «чтобы папка
  // домена показывала наличие выделенных проектов внутри»); making it a per-rule field is the way
  // to have it without imposing it, and that means touching `HighlightSpec`, the rules schema and
  // its validation — stage 04's subject, not this one. Recorded in 03-tree-view.md.
  return new vscode.FileDecoration(spec.badge, spec.tooltip, color);
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
 * call to signal every URI whose decoration changed.
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
