/**
 * `TreeElement` → `vscode.TreeItem`. `HighlightSpec` → `TreeItemLabel.highlights` is rendered here
 * via `toTreeItemLabel` (package 03-B); the `FileDecoration` carrier lives entirely in
 * `../decorations/decoration-provider.ts` since it is not a per-item concern (fact 8: the provider
 * is global, not called from here).
 */
import * as vscode from 'vscode';
import type { HighlightSpec } from '../../projects/classification/index.js';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { RUN_PRIMARY_ACTION_COMMAND } from '../commands/index.js';
import { toTreeItemLabel } from '../decorations/index.js';
import type { ExpansionState } from './expansion.js';
import { treeElementKey } from './registry.js';
import { isRootGroupNode, type RootGroupNode, type TreeElement } from './root-group.js';

/**
Looks up what the expansion store remembers for `key`, or `undefined` for "never recorded" — a
node the platform already knows keeps its own state regardless of what this returns, because
`collapsibleState` is merely the *default* the platform uses the first time a node's `id` appears
in a given view (api-facts.md, fact 41).
*/
export type ExpansionLookup = (key: string) => ExpansionState | undefined;

function collapsibleStateFor(
  hasChildren: boolean,
  stored: ExpansionState | undefined,
  defaultWhenNonEmpty: ExpansionState,
): vscode.TreeItemCollapsibleState {
  if (!hasChildren) return vscode.TreeItemCollapsibleState.None;
  const effective = stored ?? defaultWhenNonEmpty;
  return effective === 'expanded'
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.Collapsed;
}

export function toTreeItem(element: TreeElement, expansionOf: ExpansionLookup): vscode.TreeItem {
  return isRootGroupNode(element)
    ? toRootGroupTreeItem(element, expansionOf)
    : toProjectTreeItem(element, expansionOf);
}

function toProjectTreeItem(node: ClassifiedNode, expansionOf: ExpansionLookup): vscode.TreeItem {
  const key = treeElementKey(node);
  const hasChildren = node.children.length > 0;
  // Per-kind default: a project node with children not otherwise remembered starts collapsed.
  const collapsibleState = collapsibleStateFor(hasChildren, expansionOf(key), 'collapsed');
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
      command: RUN_PRIMARY_ACTION_COMMAND,
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
function toRootGroupTreeItem(group: RootGroupNode, expansionOf: ExpansionLookup): vscode.TreeItem {
  const key = treeElementKey(group);
  // Per-kind default: a non-empty root group not otherwise remembered starts expanded — the
  // opposite default from a project node, which is exactly why this needed its own lookup rather
  // than a hardcoded `Expanded` (round 06 review, codex-03: the hardcoded value could not express
  // a root group the user had collapsed, so it reopened on every switch between the two views).
  const collapsibleState = collapsibleStateFor(
    group.children.length > 0,
    expansionOf(key),
    'expanded',
  );
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
