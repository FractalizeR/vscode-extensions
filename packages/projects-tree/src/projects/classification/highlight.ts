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
  /**
  Climbs this decoration to the node's ancestors in the Explorer/tree (VS Code's own
  `FileDecoration.propagate`). A per-rule field, not a provider-wide policy: the decoration
  provider is global (api-facts.md, fact 8), so a blanket "always propagate" would badge folders
  above any highlighted project in the Explorer whether the user asked for that project's rule to
  climb or not, with no way to turn it off short of disabling file decorations entirely. Making it
  a field the rule author sets lets a highlight climb only where deliberately asked for.

  Even opted in, this does not climb only as far as the rule's own configured root: VS Code's
  native propagation walks the literal filesystem hierarchy with no concept of "our root", so it
  can badge ancestor folders in the built-in Explorer that sit outside anything ProjectsTree
  manages (api-facts.md, fact 62). Accepted, not fixable at this API surface — recorded so a future
  reader does not mistake the resulting Explorer badge for a bug in this field.
  */
  propagate?: boolean;
}
