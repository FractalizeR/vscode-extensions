import { describe, expect, it } from 'vitest';
import type { NodeFacts } from '../../../projects/classification/index.js';
import type { ActionDefinition } from '../../../projects/actions/index.js';
import { compileAppliesTo } from './applies-to.js';

function makeFacts(name: string): NodeFacts {
  return {
    rootId: 'r',
    absolutePath: `/work/${name}`,
    pathFromRoot: name,
    name,
    depthFromRoot: 1,
    entries: [],
  };
}

describe('compileAppliesTo', () => {
  it('matches every node when the action declares no appliesTo', () => {
    const action: ActionDefinition = { id: 'a', spec: { kind: 'openFolder', window: 'auto' } };

    expect(compileAppliesTo(action)(makeFacts('anything'))).toBe(true);
  });

  it('narrows to the condition when appliesTo is declared', () => {
    const action: ActionDefinition = {
      id: 'a',
      appliesTo: { kind: 'nameMatches', pattern: '^php' },
      spec: { kind: 'openFolder', window: 'auto' },
    };
    const predicate = compileAppliesTo(action);

    expect(predicate(makeFacts('php-app'))).toBe(true);
    expect(predicate(makeFacts('node-app'))).toBe(false);
  });
});
