/**
 * Pure merge logic behind `projectsTree.addRoot` (`docs/plans/projects-tree/04-actions.md`,
 * package 04-E, "Add Root…"). Kept separate from `settings.ts`'s `vscode.workspace` calls so it is
 * unit-testable without a `vscode` mock — the whole point of splitting the command (I/O: pick
 * folders, read, write) from the decision (what the written array should contain).
 */
import type { ConfiguredRoot } from './settings.js';

/**
The shape `projectsTree.roots` is written back as: a bare path when the root has no label (matches
what a user would type by hand), an object only when a label needs somewhere to live. Never carries
`ConfiguredRoot.id` — that field is derived (`= path`), not part of the setting's own schema, and
the setting's `additionalProperties: false` would make writing it there wrong twice over.
*/
export type RawRootEntry = string | { path: string; label?: string };

/**
Appends every path in `newPaths` not already present in `existing` (by `path`, exact match).
`existing` entries are carried through unchanged — including any `label` — and never reordered or
deduplicated against each other; only new-vs-existing and new-vs-new duplicates are dropped.
*/
export function mergeRoots(
  existing: readonly ConfiguredRoot[],
  newPaths: readonly string[],
): RawRootEntry[] {
  const merged: RawRootEntry[] = existing.map((root) => toRawEntry(root));
  const knownPaths = new Set(existing.map((root) => root.path));
  for (const path of newPaths) {
    if (knownPaths.has(path)) continue;
    knownPaths.add(path);
    merged.push(path);
  }
  return merged;
}

function toRawEntry(root: ConfiguredRoot): RawRootEntry {
  return root.label === undefined ? root.path : { path: root.path, label: root.label };
}
