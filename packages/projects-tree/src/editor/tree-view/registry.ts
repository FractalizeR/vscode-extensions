/**
 * `ExtHostTreeView` addresses tree items by object identity (`docs/plans/projects-tree/
 * api-facts.md`, fact 4): firing `onDidChangeTreeData` with a freshly created node for a key the
 * view already knows about is a silent no-op, not a redraw. `NodeRegistry` hands out one object
 * per `NodeKey` and mutates it in place on every re-discovery, so a node already shown in the tree
 * keeps its identity — and therefore its selection/expansion state — across refreshes.
 *
 * The key is `rootId` + path, not path alone: two configured roots can overlap on disk, and a
 * path-only key would collide their nodes (`docs/plans/projects-tree/00-overview.md`).
 */
import type { ClassifiedNode } from '../../projects/discovery/index.js';
import { isRootGroupNode, type RootGroupNode, type TreeElement } from './root-group.js';

export type NodeKey = string;

export function nodeKey(rootId: string, pathFromRoot: string): NodeKey {
  return `${rootId}:${pathFromRoot}`;
}

/**
The key for any tree element, and deliberately the same string `item.ts` assigns to `TreeItem.id`:
the platform matches a node's remembered expansion state by that id (fact 27), so a key derived
differently anywhere else would address state the view can never match back. Root groups live in
their own `root:` namespace — they are keyed by `rootId` alone and have no path to collide on.
*/
export function treeElementKey(element: TreeElement): NodeKey {
  return isRootGroupNode(element)
    ? `root:${element.rootId}`
    : nodeKey(element.facts.rootId, element.facts.pathFromRoot);
}

type MutableNode = { -readonly [K in keyof ClassifiedNode]: ClassifiedNode[K] };

export class NodeRegistry {
  readonly #canonical = new Map<NodeKey, ClassifiedNode>();

  /**
  Returns the canonical object for `node`'s key, recursively canonicalizing its children first.
  A key seen before returns the same object it always has, its fields overwritten in place from
  `node`; a new key stores `node` (with its children replaced by their canonical counterparts) and
  returns it.
  */
  canonicalize(node: ClassifiedNode): ClassifiedNode {
    const children = node.children.map((child) => this.canonicalize(child));
    const key = nodeKey(node.facts.rootId, node.facts.pathFromRoot);
    const existing = this.#canonical.get(key);
    if (existing === undefined) {
      const created: ClassifiedNode = { ...node, children };
      this.#canonical.set(key, created);
      return created;
    }
    const mutable = existing as MutableNode;
    mutable.facts = node.facts;
    mutable.verdict = node.verdict;
    mutable.children = children;
    mutable.entriesRead = node.entriesRead;
    return existing;
  }

  forget(key: NodeKey): void {
    this.#canonical.delete(key);
  }

  /**
  Drops every canonical object whose key is not in `liveKeys`. Called by `ProjectsTreeProvider`
  after each discovery pass, because `canonicalize` only ever adds and updates: without a sweep the
  map keeps an entry for every node ever seen, including ones deleted from disk, and it becomes the
  cache-without-invalidation the plan deferred to stage 07 rather than the identity table it is
  meant to be. Forgetting a key is correct rather than merely tidy — a node that reappears later is
  genuinely a new node, and giving it a fresh object is what `canonicalize` would do anyway.
  */
  retainOnly(liveKeys: ReadonlySet<NodeKey>): void {
    for (const key of this.#canonical.keys()) {
      if (!liveKeys.has(key)) this.#canonical.delete(key);
    }
  }

  /**
  Drops every canonical object. Reserved for a rules- or roots-change, not called on every
  refresh: a plain refresh re-discovers the same roots and relies on `canonicalize` updating
  existing objects in place to keep identity stable.
  */
  invalidate(): void {
    this.#canonical.clear();
  }
}

/**
Same identity-preservation contract as `NodeRegistry`, one object per `rootId` — a root group node
has no path of its own to key on. Kept as a separate class rather than a branch inside
`NodeRegistry` because its key space (`rootId` alone) and payload (`label`, not a `Verdict`) are
different enough that sharing the map would mean every lookup re-deciding which kind of node it
holds.
*/
export class RootGroupRegistry {
  readonly #byRootId = new Map<string, RootGroupNode>();

  canonicalize(rootId: string, label: string, children: readonly ClassifiedNode[]): RootGroupNode {
    const existing = this.#byRootId.get(rootId);
    if (existing === undefined) {
      const created: RootGroupNode = { kind: 'rootGroup', rootId, label, children };
      this.#byRootId.set(rootId, created);
      return created;
    }
    existing.label = label;
    existing.children = children;
    return existing;
  }

  invalidate(): void {
    this.#byRootId.clear();
  }

  /**
  Same sweep as `NodeRegistry.retainOnly`, over this registry's own `root:` namespace — a root
  removed from the setting must not keep its group object alive.
  */
  retainOnly(liveKeys: ReadonlySet<NodeKey>): void {
    for (const [rootId, group] of this.#byRootId) {
      if (!liveKeys.has(treeElementKey(group))) this.#byRootId.delete(rootId);
    }
  }
}
