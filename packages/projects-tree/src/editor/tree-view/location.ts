/**
 * Where the tree lives (`docs/plans/projects-tree/03-tree-view.md`, package 03-C). Pure mapping,
 * no `vscode`: the setting value decides which view ids exist and which context keys are true, and
 * both decisions are worth testing without an editor.
 *
 * The context keys the three modes map onto live in `../context-keys/names.ts`; this file owns
 * the view ids alone.
 *
 * The three modes are **two views with different ids**, not one view in two places: a view id is
 * declared once in the manifest and names one view (api-facts.md, fact 5). Everything that names a
 * view id in `package.json` — `viewsWelcome`, `menus`, `activationEvents` — is therefore duplicated
 * across both ids, and the provider is registered on both.
 */
export const ACTIVITY_BAR_VIEW_ID = 'projectsTree.view';
export const EXPLORER_VIEW_ID = 'projectsTree.explorerView';

/**
Both view ids, always. The provider is registered on both regardless of `location`, and `when`
decides which one is visible — so switching the setting needs no re-registration and no Reload
Window (03-C's DoD). Registering a provider for a view hidden by its `when` costs nothing: the
platform never asks a hidden view for children.

A mode-dependent registration was rejected: it buys nothing and turns every setting change into
disposal choreography, which is the kind of seam round 05 found broken (review-05, M1).
*/
export const ALL_VIEW_IDS: readonly string[] = [ACTIVITY_BAR_VIEW_ID, EXPLORER_VIEW_ID];
