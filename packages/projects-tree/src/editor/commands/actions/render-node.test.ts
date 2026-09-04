import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERDICT } from '../../../projects/classification/index.js';
import type { ClassifiedNode } from '../../../projects/discovery/index.js';

vi.mock('vscode', () => {
  return { workspace: { workspaceFile: undefined } };
});

const readRootsMock = vi.fn<() => { roots: readonly { id: string; path: string }[] }>(() => ({
  roots: [{ id: 'r', path: '/work/root' }],
}));

vi.mock('../../configuration/index.js', () => ({
  readRoots: () => readRootsMock(),
}));

const { toRenderNode } = await import('./render-node.js');

function makeNode(absolutePath: string, name: string, rootId = 'r'): ClassifiedNode {
  return {
    facts: {
      rootId,
      absolutePath,
      pathFromRoot: name,
      name,
      depthFromRoot: 1,
      entries: [],
    },
    entriesRead: true,
    verdict: DEFAULT_VERDICT,
    children: [],
  };
}

describe('toRenderNode', () => {
  it('adapts a ClassifiedNode plus its root path into an ActionRenderNode', () => {
    const node = makeNode('/work/root/my-project', 'my-project');

    expect(toRenderNode(node)).toEqual({
      path: '/work/root/my-project',
      name: 'my-project',
      parentPath: '/work/root',
      rootPath: '/work/root',
    });
  });

  /**
   * `rootId` is an opaque key, not a path (`NodeFacts.rootId`'s own doc comment) — this only stays
   * caught if the fixture's id and path actually differ. Round-07 review (native-claude-02) found
   * every call site passing `node.facts.rootId` straight through as `${rootPath}`; that bug was
   * invisible to the pre-existing tests because they always passed the path itself as the second
   * argument, matching by construction.
   */
  it("resolves ${rootPath} through readRoots() by id — the root's id is not its path", () => {
    readRootsMock.mockReturnValueOnce({
      roots: [{ id: 'opaque-root-id', path: '/work/root' }],
    });
    const node = makeNode('/work/root/my-project', 'my-project', 'opaque-root-id');

    expect(toRenderNode(node)?.rootPath).toBe('/work/root');
  });

  it("returns undefined when the node's root id is no longer configured", () => {
    readRootsMock.mockReturnValueOnce({ roots: [] });
    const node = makeNode('/work/root/my-project', 'my-project', 'gone');

    expect(toRenderNode(node)).toBeUndefined();
  });

  it('omits workspaceFile entirely when no workspace file is open', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({ workspace: { workspaceFile: undefined } }));
    vi.doMock('../../configuration/index.js', () => ({
      readRoots: () => ({ roots: [{ id: 'r', path: '/work/root' }] }),
    }));
    const { toRenderNode: freshToRenderNode } = await import('./render-node.js');

    const node = makeNode('/work/root/my-project', 'my-project');

    expect(Object.hasOwn(freshToRenderNode(node) ?? {}, 'workspaceFile')).toBe(false);
  });

  it('surfaces the workspace file path when one is open', async () => {
    vi.resetModules();
    vi.doMock('vscode', () => ({
      workspace: { workspaceFile: { fsPath: '/work/root/my.code-workspace' } },
    }));
    vi.doMock('../../configuration/index.js', () => ({
      readRoots: () => ({ roots: [{ id: 'r', path: '/work/root' }] }),
    }));
    const { toRenderNode: freshToRenderNode } = await import('./render-node.js');

    const node = makeNode('/work/root/my-project', 'my-project');

    expect(freshToRenderNode(node)?.workspaceFile).toBe('/work/root/my.code-workspace');
  });
});
