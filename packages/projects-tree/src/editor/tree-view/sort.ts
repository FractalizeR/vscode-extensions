/**
 * Split out of `item.ts`: pure ordering logic, no `vscode` — `top-level.ts` needs it and must stay
 * importable without a `vscode` module resolving (it is unit-tested without one).
 *
 * Full plan sort (03-A): `HighlightSpec.sortWeight`, then folders before projects, then
 * locale-numeric name. `sortWeight` was deferred to 03-B, which is what completes this file — it
 * comes from `verdict.highlight.value`, the same field the decorations package reads.
 *
 * Higher `sortWeight` sorts first (rejected: lower-first — "weight" reads as "how much this node
 * should stand out", and standing out means floating to the top, not the bottom). Folders sort
 * before projects within equal weight (rejected: projects first — folders-before-files/projects is
 * the convention VS Code's own Explorer defaults to, and a project is the tree's analogue of a
 * leaf/file here). Nodes with no `sortWeight` are treated as weight `0`, the same value an explicit
 * `sortWeight: 0` would carry — `HighlightSpec` does not distinguish "unset" from "zero" and this
 * file does not invent that distinction either.
 *
 * Only ever applied to `ClassifiedNode` siblings — root group nodes keep the configured root order
 * (`top-level.ts`), which is more meaningful to a user than alphabetizing their own roots setting.
 */
import type { ClassifiedNode } from '../../projects/discovery/index.js';

export function sortChildren(nodes: readonly ClassifiedNode[]): ClassifiedNode[] {
  // toSorted() would avoid the copy-then-sort dance, but it needs lib ES2023+; the project's
  // tsconfig targets ES2022 (tools/check-vsix-contents.ts has the same tradeoff).
  // eslint-disable-next-line unicorn/no-array-sort
  return [...nodes].sort(compareNodes);
}

function compareNodes(a: ClassifiedNode, b: ClassifiedNode): number {
  const byWeight = sortWeightOf(b) - sortWeightOf(a);
  if (byWeight !== 0) return byWeight;
  const byKind = kindRank(a) - kindRank(b);
  if (byKind !== 0) return byKind;
  return a.facts.name.localeCompare(b.facts.name, undefined, { numeric: true });
}

function sortWeightOf(node: ClassifiedNode): number {
  return node.verdict.highlight.value?.sortWeight ?? 0;
}

// Folders (0) before projects (1).
function kindRank(node: ClassifiedNode): number {
  return node.verdict.project.value ? 1 : 0;
}
