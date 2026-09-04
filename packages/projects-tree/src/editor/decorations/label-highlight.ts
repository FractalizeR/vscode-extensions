/**
 * `HighlightSpec.labelHighlight` → `TreeItemLabel.highlights` (api-facts.md, fact 1). The spec
 * only says whether to highlight the label, not which part of it, so the whole label becomes one
 * range. This shares the rendering channel VS Code uses for tree-search matches (fact 3) — a
 * deliberate, named tradeoff (docs/plans/projects-tree/03-tree-view.md, package 03-B), not a bug.
 */
import type * as vscode from 'vscode';
import type { HighlightSpec } from '../../projects/classification/index.js';

export function toTreeItemLabel(
  name: string,
  highlight: HighlightSpec | undefined,
): string | vscode.TreeItemLabel {
  if (highlight?.labelHighlight !== true) return name;
  return { label: name, highlights: [[0, name.length]] };
}
