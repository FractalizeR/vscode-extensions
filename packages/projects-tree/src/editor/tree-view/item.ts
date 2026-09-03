/**
 * `TreeElement` → `vscode.TreeItem`. Highlighting (`HighlightSpec` → `TreeItemLabel.highlights` /
 * `FileDecoration`) is package 03-B, out of scope for this slice — a project node is told apart
 * only by its icon and `contextValue`.
 */
import * as vscode from 'vscode';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { OPEN_PROJECT_COMMAND } from '../commands/index.js';
import { nodeKey } from './registry.js';
import { isRootGroupNode, type RootGroupNode, type TreeElement } from './root-group.js';

export function toTreeItem(element: TreeElement): vscode.TreeItem {
  return isRootGroupNode(element) ? toRootGroupTreeItem(element) : toProjectTreeItem(element);
}

function toProjectTreeItem(node: ClassifiedNode): vscode.TreeItem {
  const collapsibleState =
    node.children.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
  const item = new vscode.TreeItem(node.facts.name, collapsibleState);
  // Stable id, not derived from the label: label-derived ids "float" when the label changes and
  // silently drop selection/expansion state (api-facts.md, fact 27).
  item.id = nodeKey(node.facts.rootId, node.facts.pathFromRoot);
  // Required for FileDecorationProvider to be consulted at all (api-facts.md, fact 8) — set
  // unconditionally now so package 03-B does not have to revisit every call site.
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
  return item;
}

/**
A container, not a project: no `resourceUri` (it names no single filesystem entry the way a
`ClassifiedNode` does), no `command` — clicking it only expands/collapses, and its own
`contextValue` keeps it out of the "project"/"folder" context menus (docs/plans/projects-tree/
00-overview.md, "Корень — контейнер, а не узел").
*/
function toRootGroupTreeItem(group: RootGroupNode): vscode.TreeItem {
  const collapsibleState =
    group.children.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None;
  const item = new vscode.TreeItem(group.label, collapsibleState);
  item.id = `root:${group.rootId}`;
  item.contextValue = 'rootGroup';
  item.iconPath = new vscode.ThemeIcon('root-folder');
  return item;
}
