import path from 'node:path';
import * as vscode from 'vscode';
import type { ActionRenderNode } from '../../../projects/actions/index.js';
import type { ClassifiedNode } from '../../../projects/discovery/index.js';
import { readRoots } from '../../configuration/index.js';

/**
 * Adapts a `ClassifiedNode` (discovery's own wrapper, `discovery/walker.ts`) into the narrower
 * `ActionRenderNode` `render` (`projects/actions/render.ts`) needs. `${rootPath}` is resolved here
 * by looking `node.facts.rootId` up in `readRoots()` — `NodeFacts.rootId` is an opaque key, not the
 * root's filesystem path (`discovery/tree.ts`'s `DiscoveryRoot` holds only the mapping the walker
 * used at discovery time). An earlier revision took the caller-supplied root path as a second
 * parameter and every one of its four call sites passed `node.facts.rootId` for it — the two only
 * ever matched because `configuration/settings.ts` happens to make a root's `id` equal to its path
 * today (review-07, native-claude-02); resolving through `readRoots()` here removes the chance to
 * pass the wrong value and keeps the lookup in the one place that already owns "current root
 * configuration", instead of trusting every caller to reproduce it correctly.
 *
 * Returns `undefined` when `rootId` no longer names a configured root (removed from
 * `projectsTree.roots` since this node was discovered) — a stale selection or a keybinding fired
 * against a node from an outdated tree, not something `render` should be asked to paper over with a
 * placeholder path. Callers show a diagnostic and do not run the action.
 *
 * `parentPath` is derived with `node:path.dirname`, not read from `NodeFacts`: nothing upstream
 * carries a node's parent path today, and computing it from `absolutePath` is a one-line adapter,
 * not new discovery logic.
 */
export function toRenderNode(node: ClassifiedNode): ActionRenderNode | undefined {
  const { absolutePath, name, rootId } = node.facts;
  const rootPath = readRoots().roots.find((root) => root.id === rootId)?.path;
  if (rootPath === undefined) return undefined;

  const workspaceFile = vscode.workspace.workspaceFile;
  return {
    path: absolutePath,
    name,
    parentPath: path.dirname(absolutePath),
    rootPath,
    // api-facts.md, fact 67: `undefined` exactly when no workspace file is open — passed through
    // as-is, `${workspaceFile}` substitution turns that into a render error (render.ts), not "".
    ...(workspaceFile !== undefined && { workspaceFile: workspaceFile.fsPath }),
  };
}
