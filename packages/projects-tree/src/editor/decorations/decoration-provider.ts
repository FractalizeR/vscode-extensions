/**
 * `HighlightSpec` → `vscode.FileDecoration`, for the color/badge carrier (docs/plans/projects-tree/
 * 03-tree-view.md, package 03-B). Applied only to nodes with an explicit `color` or `badge`: a
 * `HighlightSpec` carrying only `sortWeight`, only `icon`, only `description`, or only
 * `labelHighlight` must not reach `FileDecoration` — none of those fields map onto its `badge`,
 * `tooltip` or `color`, and a decoration with none of those three throws and is dropped by the
 * platform (api-facts.md, fact 7).
 *
 * `propagate` is not a `HighlightSpec` field — the core carries no such field, and this file does
 * not invent one. It is instead a standing adapter decision, made for every decoration this module
 * builds: a highlighted project should make its enclosing domain folder show that something inside
 * it is highlighted (03-tree-view.md, package 03-B: "чтобы папка домена показывала наличие
 * выделенных проектов внутри"). Fact 9 says the platform never walks descendants on its own, so
 * `HighlightDecorationProvider.update` also signals every ancestor of a node whose decoration
 * changed through `onDidChangeFileDecorations` — that signal, not a return value from
 * `provideFileDecoration` for the ancestor, is the whole of what this module owes fact 9; the
 * ancestor's own visual merge is the platform's job once told to re-ask.
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

`tooltip` is `HighlightSpec.description`: the core defines no separate tooltip field, and
`description`'s own text is exactly what a hover over the color/badge should say.
*/
export function buildDecorationSpec(
  highlight: HighlightSpec | undefined,
): DecorationSpec | undefined {
  if (highlight === undefined) return undefined;
  const badge =
    highlight.badge !== undefined && isBadgeWithinPlatformLimit(highlight.badge)
      ? highlight.badge
      : undefined;
  if (badge === undefined && highlight.color === undefined) return undefined;
  return { badge, tooltip: highlight.description, colorId: highlight.color };
}

// The one place a `DecorationSpec` becomes a real `vscode.FileDecoration` — never introspected
// afterwards (see `DecorationSpec`'s doc comment for why).
function toFileDecoration(spec: DecorationSpec): vscode.FileDecoration {
  const color = spec.colorId === undefined ? undefined : new vscode.ThemeColor(spec.colorId);
  const decoration = new vscode.FileDecoration(spec.badge, spec.tooltip, color);
  decoration.propagate = true;
  return decoration;
}

interface CollectedEntry {
  readonly key: string;
  readonly uri: vscode.Uri;
  readonly spec: DecorationSpec | undefined;
  readonly ancestorUris: readonly vscode.Uri[];
}

/**
Walks the tree once, pairing every `ClassifiedNode` with its own decoration spec (if any) and the
URIs of every `ClassifiedNode` ancestor above it. A `RootGroupNode` contributes no entry of its own
— it has no `resourceUri` (docs/plans/projects-tree/00-overview.md, "Корень — контейнер, а не
узел") — but its children are still walked, with the ancestor chain unchanged, so a project directly
under a root group still gets the (empty) chain it would have without grouping.
*/
function collect(
  elements: readonly TreeElement[],
  ancestorUris: readonly vscode.Uri[],
  out: CollectedEntry[],
): void {
  for (const element of elements) {
    if (isRootGroupNode(element)) {
      collect(element.children, ancestorUris, out);
      continue;
    }
    const uri = vscode.Uri.file(element.facts.absolutePath);
    out.push({
      key: uri.toString(),
      uri,
      spec: buildDecorationSpec(element.verdict.highlight.value),
      ancestorUris,
    });
    collect(element.children, [...ancestorUris, uri], out);
  }
}

/**
 * Global `FileDecorationProvider` (api-facts.md, fact 8: registration carries no view id, so
 * decorations from this provider also render in the Explorer). `update` is the only write path —
 * called with the tree's current top level after every refresh — and diffs against the previous
 * call to find every URI whose decoration changed, signalling that URI *and* every one of its
 * ancestors so a propagating change is not silently missed (fact 9).
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
    collect(elements, [], entries);
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
      const ancestorUris = next?.ancestorUris ?? previous?.ancestorUris ?? [];
      for (const ancestorUri of ancestorUris) toSignal.set(ancestorUri.toString(), ancestorUri);
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
