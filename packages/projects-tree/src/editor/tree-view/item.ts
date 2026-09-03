/**
 * `TreeElement` → `vscode.TreeItem`. `HighlightSpec` → `TreeItemLabel.highlights` is rendered here
 * via `toTreeItemLabel` (package 03-B); the `FileDecoration` carrier lives entirely in
 * `../decorations/decoration-provider.ts` since it is not a per-item concern (fact 8: the provider
 * is global, not called from here).
 */
import * as vscode from 'vscode';
import type { HighlightSpec } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { OPEN_PROJECT_COMMAND } from '../commands/index.js';
import { toTreeItemLabel } from '../decorations/index.js';
import { treeElementKey } from './expansion.js';
import { isRootGroupNode, type RootGroupNode, type TreeElement } from './root-group.js';

/**
`isExpanded` overrides `collapsibleState` to `Expanded` for a node the store remembers as
open — needed only because `TreeItem.collapsibleState` is merely the *default* the platform uses
the first time a node's `id` appears in a given view (api-facts.md, fact 41); a node the platform
already knows keeps its own state regardless of what this returns. A `false` result never forces
`Collapsed`: the store cannot distinguish "never touched" from "explicitly collapsed" (it is a set
of expanded keys, nothing else), so `false` here means "no opinion, use this function's own
per-kind default" rather than "force collapsed".
*/
export function toTreeItem(
  element: TreeElement,
  isExpanded: (key: string) => boolean,
): vscode.TreeItem {
  return isRootGroupNode(element)
    ? toRootGroupTreeItem(element)
    : toProjectTreeItem(element, isExpanded);
}

function toProjectTreeItem(
  node: ClassifiedNode,
  isExpanded: (key: string) => boolean,
): vscode.TreeItem {
  const key = treeElementKey(node);
  const hasChildren = node.children.length > 0;
  const collapsibleState = hasChildren
    ? isExpanded(key)
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed
    : vscode.TreeItemCollapsibleState.None;
  const highlight = node.verdict.highlight.value;
  const label = toTreeItemLabel(node.facts.name, highlight);
  const item = new vscode.TreeItem(label, collapsibleState);
  // Stable id, not derived from the label: label-derived ids "float" when the label changes and
  // silently drop selection/expansion state (api-facts.md, fact 27).
  item.id = key;
  // Required for FileDecorationProvider to be consulted at all (api-facts.md, fact 8).
  item.resourceUri = vscode.Uri.file(node.facts.absolutePath);
  item.tooltip = node.facts.absolutePath;
  item.contextValue = node.verdict.project.value ? 'project' : 'folder';
  if (node.verdict.project.value) {
    item.iconPath = new vscode.ThemeIcon('rocket');
    item.command = {
      command: OPEN_PROJECT_COMMAND,
      title: vscode.l10n.t('Open Project'),
      arguments: [node],
    };
  }
  applyHighlightExtras(item, highlight);
  return item;
}

/**
A container, not a project: no `resourceUri` (it names no single filesystem entry the way a
`ClassifiedNode` does), no `command` — clicking it only expands/collapses, and its own
`contextValue` keeps it out of the "project"/"folder" context menus (docs/plans/projects-tree/
00-overview.md, "Корень — контейнер, а не узел"). No highlight either: a `RootGroupNode` carries no
`Verdict` (it is not a `ClassifiedNode`), so this branch never touches `HighlightSpec`.
*/
function toRootGroupTreeItem(group: RootGroupNode): vscode.TreeItem {
  const key = treeElementKey(group);
  // No `isExpanded` parameter: the default below is already `Expanded` when non-empty, and the
  // store's predicate only ever upgrades a default to `Expanded`, never downgrades one to
  // `Collapsed` (see `toTreeItem`'s doc comment) — consulting it here could not change the result.
  const collapsibleState =
    group.children.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
  const item = new vscode.TreeItem(group.label, collapsibleState);
  item.id = key;
  item.contextValue = 'rootGroup';
  item.iconPath = new vscode.ThemeIcon('root-folder');
  return item;
}

/**
`icon` and `description` are the two `HighlightSpec` fields nothing else renders. `icon` overrides
the default `ThemeIcon` set above (`rocket`, or none for a folder) — `highlight.color`, when also
set, tints it too (fact 44: `ThemeIcon`'s second constructor argument is consumed by `TreeItem`
specifically). Both are applied only when present: `TreeItem.description`/`iconPath` are typed
without `| undefined` (fact 42/44), and `exactOptionalPropertyTypes` rejects an explicit `undefined`
assignment to them.
*/
function applyHighlightExtras(item: vscode.TreeItem, highlight: HighlightSpec | undefined): void {
  if (highlight === undefined) return;
  if (highlight.description !== undefined) item.description = highlight.description;
  if (highlight.icon !== undefined) {
    const color =
      highlight.color === undefined ? undefined : new vscode.ThemeColor(highlight.color);
    item.iconPath = new vscode.ThemeIcon(highlight.icon, color);
  }
}
