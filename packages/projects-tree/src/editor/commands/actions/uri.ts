import * as vscode from 'vscode';
import { render, type ActionRenderNode, type ActionSpec } from '../../../projects/actions/index.js';

export type UriSpec = Extract<ActionSpec, { kind: 'uri' }>;

/**
 * `Uri.parse(rendered, true)` — `strict: true` (api-facts.md, fact 64) so a template that rendered
 * to something with no parseable scheme throws here, with a message this executor can show, instead
 * of `Uri.parse` silently accepting it and `openExternal` (fact 63) being handed a `Uri` nobody
 * checked.
 */
export async function runUri(spec: UriSpec, node: ActionRenderNode): Promise<void> {
  const rendered = render(spec.template, node, { kind: 'uri' });
  let target: vscode.Uri;
  try {
    target = vscode.Uri.parse(rendered, true);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      vscode.l10n.t('"{0}" is not a valid URI: {1}', rendered, reason),
    );
    return;
  }
  await vscode.env.openExternal(target);
}
