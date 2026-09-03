import { describe, expect, it } from 'vitest';
import type { Rule } from './rule';
import { validateRules } from './validation';

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'r1',
    when: { kind: 'nameMatches', pattern: '^src$' },
    verdict: {},
    ...overrides,
  };
}

describe('validateRules', () => {
  it('accepts a well-formed rule set with no diagnostics', () => {
    expect(validateRules([rule({ verdict: { skip: true } })], [])).toEqual([]);
  });

  it('reports a duplicate rule id', () => {
    const diagnostics = validateRules([rule({ id: 'dup' }), rule({ id: 'dup' })], []);
    expect(diagnostics).toContainEqual(expect.objectContaining({ path: '/rules/1/id' }));
  });

  it('reports a primaryAction that references an unknown action id', () => {
    const rules = [rule({ verdict: { project: true, primaryAction: 'missing-action' } })];
    const diagnostics = validateRules(rules, ['known-action']);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/primaryAction' }),
    );
  });

  it('accepts a primaryAction that references a known action id', () => {
    const rules = [rule({ verdict: { project: true, primaryAction: 'known-action' } })];
    expect(validateRules(rules, ['known-action'])).toEqual([]);
  });

  it('does not flag primaryAction: undefined (deliberately no action) against any known id list', () => {
    const rules = [rule({ verdict: { project: true, primaryAction: undefined } })];
    expect(validateRules(rules, [])).toEqual([]);
  });

  it('reports an unsafe regex inside nameMatches, with a path into the rule', () => {
    const rules = [rule({ when: { kind: 'nameMatches', pattern: '(a+)+' } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(expect.objectContaining({ path: '/rules/0/when/pattern' }));
  });

  it('finds an unsafe regex nested inside a combinator condition', () => {
    const rules = [
      rule({
        when: {
          kind: 'all',
          of: [
            { kind: 'depth', min: 0 },
            { kind: 'nameMatches', pattern: '(a+)+' },
          ],
        },
      }),
    ];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/when/of/1/pattern' }),
    );
  });

  it('reports a highlight badge longer than two characters', () => {
    const rules = [rule({ verdict: { highlight: { badge: 'ABC' } } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/highlight/badge' }),
    );
  });

  it('accepts a two-character badge', () => {
    const rules = [rule({ verdict: { highlight: { badge: 'AB' } } })];
    expect(validateRules(rules, [])).toEqual([]);
  });

  it('reports an entirely empty highlight object', () => {
    const rules = [rule({ verdict: { highlight: {} } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/highlight' }),
    );
  });

  it('accepts a highlight object that only sets sortWeight', () => {
    const rules = [rule({ verdict: { highlight: { sortWeight: 1 } } })];
    expect(validateRules(rules, [])).toEqual([]);
  });

  it('returns every diagnostic for a rule set with several independent problems, not just the first', () => {
    // Regression: DoD requires "все диагностики" — proven broken/fixed in the session report by
    // making validateRules return only diagnostics[0] and observing this test go red.
    const rules = [
      rule({ id: 'dup', when: { kind: 'nameMatches', pattern: '(a+)+' } }),
      rule({ id: 'dup', verdict: { project: true, primaryAction: 'missing' } }),
    ];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics.length).toBeGreaterThanOrEqual(3);
    expect(diagnostics).toContainEqual(expect.objectContaining({ path: '/rules/1/id' }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ path: '/rules/0/when/pattern' }));
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/1/then/primaryAction' }),
    );
  });
});
