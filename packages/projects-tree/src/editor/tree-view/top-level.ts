/**
 * Decides what the tree's top level looks like, given the core's flat, per-root-tagged node list
 * (`docs/plans/projects-tree/00-overview.md`, "Корень — контейнер, а не узел"). Split out of
 * `provider.ts` so this decision — pure data in, pure data out — is testable without a fake
 * filesystem or `vscode`.
 */
import nodePath from 'node:path';
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import type { ConfiguredRoot, ShowRootNodes } from '../configuration/index.js';
import { sortChildren } from './sort.js';
import type { RootGroupRegistry } from './registry.js';
import type { TreeElement } from './root-group.js';

/**
One root shows its content directly; several roots are grouped into one container per root unless
`mode` overrides that (`always` groups even a single root, `never` flattens even several). Group
order follows `roots`, the order the user configured — not name, which would make root position
jump around after an edit that only changes a label.
*/
export function buildTopLevel(
  nodes: readonly ClassifiedNode[],
  roots: readonly ConfiguredRoot[],
  mode: ShowRootNodes,
  groupRegistry: RootGroupRegistry,
): TreeElement[] {
  const shouldGroup = mode === 'always' || (mode === 'auto' && roots.length > 1);
  if (!shouldGroup) return sortChildren(nodes);

  return roots.map((root) => {
    const children = nodes.filter((node) => node.facts.rootId === root.id);
    const label = root.label ?? nodePath.basename(root.path);
    return groupRegistry.canonicalize(root.id, label, children);
  });
}
