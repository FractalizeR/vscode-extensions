/**
 * A synthetic top-level container for one configured root's children, shown when several roots
 * are configured (`docs/plans/projects-tree/00-overview.md`, "Корень — контейнер, а не узел"). Not
 * a core concept: the core stopped emitting a node for the root itself, and grouping several
 * roots' content back into labeled containers is a display decision the adapter owns alone.
 */
import type { ClassifiedNode } from '../../projects/discovery/index.js';

export interface RootGroupNode {
  readonly kind: 'rootGroup';
  readonly rootId: string;
  label: string;
  children: readonly ClassifiedNode[];
}

export type TreeElement = ClassifiedNode | RootGroupNode;

export function isRootGroupNode(element: TreeElement): element is RootGroupNode {
  return 'kind' in element;
}
