import { describe, expect, it } from 'vitest';
import { BUILT_IN_ACTIONS, DEFAULT_ACTION_ID } from './builtin';

describe('BUILT_IN_ACTIONS', () => {
  it('declares exactly the three openFolder windows the plan names', () => {
    expect(BUILT_IN_ACTIONS.map((action) => action.id)).toEqual([
      'builtin.openInNewWindow',
      'builtin.openInCurrentWindow',
      'builtin.openAuto',
    ]);
    expect(BUILT_IN_ACTIONS.map((action) => action.spec)).toEqual([
      { kind: 'openFolder', window: 'new' },
      { kind: 'openFolder', window: 'current' },
      { kind: 'openFolder', window: 'auto' },
    ]);
  });

  it('carries no appliesTo — built-ins apply to every project node', () => {
    expect(BUILT_IN_ACTIONS.every((action) => action.appliesTo === undefined)).toBe(true);
  });

  it('DEFAULT_ACTION_ID names one of the declared built-ins', () => {
    expect(BUILT_IN_ACTIONS.map((action) => action.id)).toContain(DEFAULT_ACTION_ID);
  });
});
