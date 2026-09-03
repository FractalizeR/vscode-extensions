// Lives in classification/, not editor/: a highlight is part of a rule's verdict, not a
// rendering detail (docs/plans/projects-tree/00-overview.md, "Архитектурное решение").

/**
 * Visual emphasis a rule can attach to a node. `badge` must not exceed two characters — VS Code's
 * `FileDecoration` validation throws and drops the whole decoration, `color` included, when it
 * does (docs/plans/projects-tree/api-facts.md, fact 7). Enforcing that is package 02-B's job; this
 * type only carries the field.
 *
 * A `HighlightSpec` with every field left `undefined` must not reach the decoration layer as an
 * empty object: VS Code rejects a decoration with no `color`, `badge` and `tooltip` the same way
 * (fact 7). `sortWeight` alone is a legitimate `HighlightSpec` (it affects ordering only, not the
 * decoration), so "all fields undefined" and "only sortWeight set" are different states — that
 * distinction, and the emptiness check itself, also belong to 02-B/the adapter, not here.
 */
export interface HighlightSpec {
  /**
  Occupies the same channel VS Code uses to highlight tree search matches (fact 3).
  */
  labelHighlight?: boolean;
  /**
  A `ThemeColor` id.
  */
  color?: string;
  badge?: string;
  icon?: string;
  description?: string;
  sortWeight?: number;
}
