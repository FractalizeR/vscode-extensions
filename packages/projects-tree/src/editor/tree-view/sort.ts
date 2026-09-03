/**
 * Split out of `item.ts`: pure ordering logic, no `vscode` — `top-level.ts` needs it and must stay
 * importable without a `vscode` module resolving (it is unit-tested without one).
 *
 * Plan sort (weight, then folder/project, then locale-numeric name — 03-A) deferred: `sortWeight`
 * comes from `HighlightSpec` (03-B), out of scope here. This is name-only, numeric-aware ordering
 * ("project2" before "project10"), stable and cheap enough to keep even after 03-B adds the rest.
 * Only ever applied to `ClassifiedNode` siblings — root group nodes keep the configured root order
 * (`top-level.ts`), which is more meaningful to a user than alphabetizing their own roots setting.
 */
import type { ClassifiedNode } from '../../projects/discovery/index.js';

export function sortChildren(nodes: readonly ClassifiedNode[]): ClassifiedNode[] {
  // toSorted() would avoid the copy-then-sort dance, but it needs lib ES2023+; the project's
  // tsconfig targets ES2022 (tools/check-vsix-contents.ts has the same tradeoff).
  // eslint-disable-next-line unicorn/no-array-sort
  return [...nodes].sort((a, b) =>
    a.facts.name.localeCompare(b.facts.name, undefined, { numeric: true }),
  );
}
