import { describe, expect, it } from 'vitest';
import { DEFAULT_VERDICT } from '../../../projects/classification/index.js';
import type { RawActionDefinition } from '../../../projects/classification/index.js';
import { BUILT_IN_ACTIONS } from '../../../projects/actions/index.js';
import type { ClassifiedNode } from '../../../projects/discovery/index.js';
import { createActionRegistry } from './registry.js';

function makeNode(name: string): ClassifiedNode {
  return {
    facts: {
      rootId: 'r',
      absolutePath: `/work/${name}`,
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

describe('createActionRegistry', () => {
  it('exposes every built-in action with no rules-file actions declared', () => {
    const registry = createActionRegistry([]);

    expect(registry.ids()).toEqual(BUILT_IN_ACTIONS.map((action) => action.id));
    expect(registry.byId('builtin.openAuto')).toEqual(BUILT_IN_ACTIONS[2]);
  });

  it('adds file-declared actions alongside the built-ins', () => {
    const fileActions: RawActionDefinition[] = [
      { id: 'custom.opencode', spec: { kind: 'terminal', command: 'opencode', shell: 'zsh' } },
    ];
    const registry = createActionRegistry(fileActions);

    expect(registry.ids()).toContain('custom.opencode');
    expect(registry.byId('custom.opencode')).toEqual(fileActions[0]);
    // Built-ins are still present — a rules file with its own actions does not replace the set.
    expect(registry.byId('builtin.openInNewWindow')).toEqual(BUILT_IN_ACTIONS[0]);
  });

  it('lets a file-declared action with a built-in id win over the built-in', () => {
    const override: RawActionDefinition = {
      id: 'builtin.openAuto',
      title: 'Custom auto-open',
      spec: { kind: 'terminal', command: 'echo hi', shell: 'bash' },
    };
    const registry = createActionRegistry([override]);

    expect(registry.byId('builtin.openAuto')).toEqual(override);
    // The id count does not grow — this is a replacement, not a duplicate entry.
    expect(registry.ids().filter((id) => id === 'builtin.openAuto')).toHaveLength(1);
  });

  it('byId returns undefined for an id nothing declares', () => {
    expect(createActionRegistry([]).byId('does.not.exist')).toBeUndefined();
  });

  it('applicableTo filters by appliesTo, keeping actions with none unconditionally', () => {
    const fileActions: RawActionDefinition[] = [
      {
        id: 'custom.phpOnly',
        appliesTo: { kind: 'nameMatches', pattern: '^php' },
        spec: { kind: 'openFolder', window: 'new' },
      },
    ];
    const registry = createActionRegistry(fileActions);

    const applicable = registry.applicableTo(makeNode('php-app')).map((action) => action.id);
    expect(applicable).toContain('custom.phpOnly');
    expect(applicable).toEqual(expect.arrayContaining(BUILT_IN_ACTIONS.map((action) => action.id)));

    const notApplicable = registry.applicableTo(makeNode('node-app')).map((action) => action.id);
    expect(notApplicable).not.toContain('custom.phpOnly');
  });
});
