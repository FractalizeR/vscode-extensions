import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClassifier, DEFAULT_RULES } from '../../projects/classification/index.js';
import type { DirEntry, NodeFacts } from '../../projects/classification/index.js';
import type { ClassifiedNode, FileSystemReader } from '../../projects/discovery/index.js';
import { readRulesFileForEdit } from '../rules/index.js';
import type { NodeSelection } from './node-selection.js';

const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const showErrorMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const showInformationMessageMock = vi.fn<(...args: unknown[]) => unknown>();
const showQuickPickMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      registeredHandlers.set(id, handler);
      return {
        dispose: () => {
          // no-op fake disposable
        },
      };
    },
  },
  window: {
    showErrorMessage: showErrorMessageMock,
    showInformationMessage: showInformationMessageMock,
    showQuickPick: showQuickPickMock,
  },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { registerHideCommand, registerManageHiddenCommand, HIDE_COMMAND, MANAGE_HIDDEN_COMMAND } =
  await import('./hidden.js');

const state: { storageDir: string } = { storageDir: '' };

beforeEach(async () => {
  state.storageDir = await mkdtemp(nodePath.join(tmpdir(), 'projects-tree-hidden-'));
  registeredHandlers.clear();
  showErrorMessageMock.mockClear();
  showInformationMessageMock.mockClear();
  showQuickPickMock.mockClear();
});

afterEach(async () => {
  await rm(state.storageDir, { recursive: true, force: true });
});

function location(): { globalStorageUri: { fsPath: string } } {
  return { globalStorageUri: { fsPath: state.storageDir } };
}

function nodeWithFacts(facts: Partial<NodeFacts>, wereEntriesRead = true): ClassifiedNode {
  return {
    facts: {
      rootId: 'root1',
      absolutePath: '/work/x',
      pathFromRoot: 'x',
      name: 'x',
      depthFromRoot: 1,
      entries: [],
      ...facts,
    },
    verdict: {
      skip: { value: false, byRule: undefined },
      stopDescend: { value: false, byRule: undefined },
      project: { value: false, byRule: undefined },
      primaryAction: { value: undefined, byRule: undefined },
      highlight: { value: undefined, byRule: undefined },
      tags: { value: [], byRule: undefined },
    },
    children: [],
    entriesRead: wereEntriesRead,
  };
}

/**
 * `readDirectory` is the only method `currentEntries` (`hidden.ts`) calls; the rest are stubs no
 * test here exercises.
 */
function fakeFs(entries: readonly DirEntry[] = []): FileSystemReader {
  return {
    readDirectory: () => Promise.resolve(entries),
    readFile: () => Promise.resolve(''),
    identity: () => Promise.resolve(''),
    realPath: (path: string) => Promise.resolve(path),
  };
}

function noSelection(): NodeSelection {
  return {
    currentProjectNode: (): ClassifiedNode | undefined => undefined,
    currentNode: (): ClassifiedNode | undefined => undefined,
  };
}

describe('registerHideCommand', () => {
  it('reports rather than throws when nothing is selected', async () => {
    const refresh = vi.fn<() => Promise<void>>();
    registerHideCommand(location(), [], refresh, noSelection(), fakeFs());

    await registeredHandlers.get(HIDE_COMMAND)?.();

    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  /**
   * DoD: "путь с `(` и `+` в имени скрывается корректно". `a(b)+c` is a regex, unanchored, over
   * `abbc` — if `hideRuleFor` ever regressed from `pathEquals` to a `nameMatches` regex built from
   * the raw path (this test's whole reason to exist), the unescaped `(b)+` would match "one or more
   * b" inside `abbc` and silently hide the *other* node too.
   */
  it('hides by exact path — a path containing "(" and "+" never behaves like a regex', async () => {
    const refresh = vi.fn<() => Promise<void>>();
    const target = nodeWithFacts({ pathFromRoot: 'a(b)+c', name: 'a(b)+c' });
    registerHideCommand(location(), [], refresh, noSelection(), fakeFs());

    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    expect(refresh).toHaveBeenCalledTimes(1);
    const { file } = await readRulesFileForEdit(location(), []);
    expect(file?.rules).toHaveLength(1);

    const classifier = createClassifier([...(file?.rules ?? []), ...DEFAULT_RULES]);
    expect(classifier.classify(target.facts).skip.value).toBe(true);

    const other = nodeWithFacts({ pathFromRoot: 'abbc', name: 'abbc' });
    expect(classifier.classify(other.facts).skip.value).toBe(false);
  });

  it("scopes the hide rule to the node's own root — a same-path node in a different root is unaffected", async () => {
    const refresh = vi.fn<() => Promise<void>>();
    const target = nodeWithFacts({ rootId: 'root1', pathFromRoot: 'shared', name: 'shared' });
    registerHideCommand(location(), [], refresh, noSelection(), fakeFs());

    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    const { file } = await readRulesFileForEdit(location(), []);
    const classifier = createClassifier([...(file?.rules ?? []), ...DEFAULT_RULES]);
    expect(classifier.classify(target.facts).skip.value).toBe(true);

    const sameNameOtherRoot = nodeWithFacts({
      rootId: 'root2',
      pathFromRoot: 'shared',
      name: 'shared',
    });
    expect(classifier.classify(sameNameOtherRoot.facts).skip.value).toBe(false);
  });

  /**
   * Breaking-test target: removing this "already hidden" check makes a second, lower-priority
   * `skip` rule for the same node — first-match per field (`classifier.ts`) means it is never
   * consulted, exactly the dead rule the plan's DoD forbids.
   */
  it('reports rather than writing a second rule when the node is already hidden', async () => {
    const refresh = vi.fn<() => Promise<void>>();
    const target = nodeWithFacts({ pathFromRoot: 'once', name: 'once' });
    registerHideCommand(location(), [], refresh, noSelection(), fakeFs());
    await registeredHandlers.get(HIDE_COMMAND)?.(target);
    refresh.mockClear();
    showInformationMessageMock.mockClear();

    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    const { file } = await readRulesFileForEdit(location(), []);
    expect(file?.rules).toHaveLength(1);
  });

  /**
   * `entriesRead: false` means `target.facts.entries` is `[]` without the walker having actually
   * looked — a `hasChild` skip rule added to the file after the last tree refresh must still be
   * checked against the real directory listing (`fakeFs`, not the stale `[]`), or "Hide" would
   * write a second, dead rule on top of a node it wrongly believes is not yet hidden.
   */
  it('reads the directory before concluding "not hidden" when the node was discovered without entries', async () => {
    const { writeRulesFile } = await import('../rules/index.js');
    await writeRulesFile(
      location(),
      {
        version: 1,
        rules: [
          {
            id: 'hides-anything-with-marker',
            when: { kind: 'hasChild', names: ['.marker'] },
            verdict: { skip: true },
          },
        ],
        actions: [],
      },
      undefined,
    );

    const refresh = vi.fn<() => Promise<void>>();
    const target = nodeWithFacts(
      { pathFromRoot: 'unread-dir', name: 'unread-dir', entries: [] },
      false,
    );
    registerHideCommand(
      location(),
      [],
      refresh,
      noSelection(),
      fakeFs([{ name: '.marker', type: 'file' }]),
    );

    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    const { file } = await readRulesFileForEdit(location(), []);
    expect(file?.rules).toHaveLength(1);
  });

  it('writes a hide rule with no title — locale-neutral on disk, R07-L10N-BYPASS', async () => {
    // Regression: an earlier version wrote `title: 'Hide: ${path}'`, an English sentence baked
    // into the rules file forever regardless of the UI's later locale.
    const refresh = vi.fn<() => Promise<void>>();
    const target = nodeWithFacts({ pathFromRoot: 'silent', name: 'silent' });
    registerHideCommand(location(), [], refresh, noSelection(), fakeFs());

    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    const { file } = await readRulesFileForEdit(location(), []);
    expect(file?.rules[0]?.title).toBeUndefined();
  });

  it('reports when a node already skipped by DEFAULT_RULES is hidden again', async () => {
    const refresh = vi.fn<() => Promise<void>>();
    // `node_modules` is skipped by the default `ignored-folders` rule without any user rule at all.
    const target = nodeWithFacts({ pathFromRoot: 'node_modules', name: 'node_modules' });
    registerHideCommand(location(), [], refresh, noSelection(), fakeFs());

    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    const { file } = await readRulesFileForEdit(location(), []);
    expect(file?.rules).toHaveLength(0);
  });
});

describe('registerManageHiddenCommand', () => {
  it('reports when nothing is hidden', async () => {
    const refresh = vi.fn<() => Promise<void>>();
    registerManageHiddenCommand(location(), [], refresh);

    await registeredHandlers.get(MANAGE_HIDDEN_COMMAND)?.();

    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
    expect(showQuickPickMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('un-hides the picked node — it is no longer skipped after Manage Hidden', async () => {
    const hideRefresh = vi.fn<() => Promise<void>>();
    const target = nodeWithFacts({ pathFromRoot: 'restore-me', name: 'restore-me' });
    registerHideCommand(location(), [], hideRefresh, noSelection(), fakeFs());
    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    const manageRefresh = vi.fn<() => Promise<void>>();
    registerManageHiddenCommand(location(), [], manageRefresh);
    showQuickPickMock.mockImplementation((items: unknown) =>
      Promise.resolve(items as { rule: { id: string } }[]),
    );

    await registeredHandlers.get(MANAGE_HIDDEN_COMMAND)?.();

    expect(manageRefresh).toHaveBeenCalledTimes(1);
    const { file } = await readRulesFileForEdit(location(), []);
    expect(file?.rules).toHaveLength(0);
    const classifier = createClassifier([...(file?.rules ?? []), ...DEFAULT_RULES]);
    expect(classifier.classify(target.facts).skip.value).toBe(false);
  });

  it('does nothing when the QuickPick is dismissed', async () => {
    const target = nodeWithFacts({ pathFromRoot: 'keep-me', name: 'keep-me' });
    registerHideCommand(location(), [], vi.fn(), noSelection(), fakeFs());
    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    const refresh = vi.fn<() => Promise<void>>();
    registerManageHiddenCommand(location(), [], refresh);
    showQuickPickMock.mockResolvedValue(undefined);

    await registeredHandlers.get(MANAGE_HIDDEN_COMMAND)?.();

    expect(refresh).not.toHaveBeenCalled();
    const { file } = await readRulesFileForEdit(location(), []);
    expect(file?.rules).toHaveLength(1);
  });

  it('labels a hide rule from its path, built fresh at display time rather than a stored title', async () => {
    const refresh = vi.fn<() => Promise<void>>();
    const target = nodeWithFacts({ pathFromRoot: 'packages/foo', name: 'foo' });
    registerHideCommand(location(), [], refresh, noSelection(), fakeFs());
    await registeredHandlers.get(HIDE_COMMAND)?.(target);

    let offeredLabels: string[] = [];
    showQuickPickMock.mockImplementation((items: unknown) => {
      offeredLabels = (items as { label: string }[]).map((item) => item.label);
      return Promise.resolve(undefined);
    });
    registerManageHiddenCommand(location(), [], vi.fn());
    await registeredHandlers.get(MANAGE_HIDDEN_COMMAND)?.();

    expect(offeredLabels).toEqual(['Hide: packages/foo']);
  });

  it('falls back to the stored title for a pre-existing hide rule that already carries one', async () => {
    // A hide rule written before this fix (or hand-edited) may still carry an English `title` on
    // disk — old data must still display, not disappear or throw.
    const { writeRulesFile } = await import('../rules/index.js');
    await writeRulesFile(
      location(),
      {
        version: 1,
        rules: [
          {
            id: 'projectsTree.hidden:legacy',
            title: 'Hide: legacy/path',
            when: {
              kind: 'all',
              of: [
                { kind: 'inRoot', rootId: 'root1' },
                { kind: 'pathEquals', path: 'legacy/path' },
              ],
            },
            verdict: { skip: true },
          },
        ],
        actions: [],
      },
      undefined,
    );

    let offeredLabels: string[] = [];
    showQuickPickMock.mockImplementation((items: unknown) => {
      offeredLabels = (items as { label: string }[]).map((item) => item.label);
      return Promise.resolve(undefined);
    });
    registerManageHiddenCommand(location(), [], vi.fn());
    await registeredHandlers.get(MANAGE_HIDDEN_COMMAND)?.();

    // The path is recoverable from `when` regardless, so the rebuilt label wins over the stored
    // title — consistent, freshly-localized text beats a frozen one whenever both are available.
    expect(offeredLabels).toEqual(['Hide: legacy/path']);
  });

  it('never offers a rule the user wrote by hand — only ones Hide created', async () => {
    const { writeRulesFile } = await import('../rules/index.js');
    await writeRulesFile(
      location(),
      {
        version: 1,
        rules: [
          {
            id: 'user-written',
            title: 'My own rule',
            when: { kind: 'nameMatches', pattern: '^mine$' },
            verdict: { skip: true },
          },
        ],
        actions: [],
      },
      undefined,
    );

    const refresh = vi.fn<() => Promise<void>>();
    registerManageHiddenCommand(location(), [], refresh);

    await registeredHandlers.get(MANAGE_HIDDEN_COMMAND)?.();

    expect(showInformationMessageMock).toHaveBeenCalledTimes(1);
    expect(showQuickPickMock).not.toHaveBeenCalled();
  });
});
