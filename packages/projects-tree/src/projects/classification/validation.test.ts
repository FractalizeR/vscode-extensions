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

  it('reports an uncompilable pattern as a diagnostic instead of letting it throw later', () => {
    // Regression: an invalid pattern used to pass validation with zero diagnostics and only throw
    // a SyntaxError once `compileCondition` ran, later, during a walk.
    const rules = [rule({ when: { kind: 'nameMatches', pattern: '(' } })];
    expect(() => validateRules(rules, [])).not.toThrow();
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(expect.objectContaining({ path: '/rules/0/when/pattern' }));
  });

  it('reports an uncompilable flags string as a diagnostic', () => {
    const rules = [rule({ when: { kind: 'nameMatches', pattern: '^src$', flags: 'q' } })];
    expect(() => validateRules(rules, [])).not.toThrow();
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(expect.objectContaining({ path: '/rules/0/when/pattern' }));
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

  it('accepts a one-character badge', () => {
    const rules = [rule({ verdict: { highlight: { badge: '!' } } })];
    expect(validateRules(rules, [])).toEqual([]);
  });

  it(// codex-05 (review-06): '' passes VS Code's own emptiness check (`!d.badge` is true for ''),
  // so a decoration that also sets `description`/`color` was accepted whole while the badge slot
  // rendered nothing visible — invisible-but-present, not caught by the length check above.
  'rejects an empty badge, even when another field also sets a decorating value', () => {
    const rules = [rule({ verdict: { highlight: { badge: '', color: 'charts.red' } } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/highlight/badge' }),
    );
  });

  it('rejects a whitespace-only badge the same way as an empty one', () => {
    // Decision: whitespace-only is folded into the same rule as '' rather than left to pass as
    // "technically non-empty" — a badge no rule author can see is the same defect either way.
    const rules = [rule({ verdict: { highlight: { badge: '  ', color: 'charts.red' } } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/highlight/badge' }),
    );
  });

  it('treats an empty badge as no decorating field when nothing else is set either', () => {
    const rules = [rule({ verdict: { highlight: { badge: '' } } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/highlight' }),
    );
  });

  it('accepts a single-emoji badge, a surrogate pair counted as one code point', () => {
    // Regression: `.length` counts UTF-16 code units, so '🔥' (`.length === 2`) used to be
    // rejected even though VS Code's own check (api-facts.md fact 7) accepts it as one character.
    const rules = [rule({ verdict: { highlight: { badge: '🔥' } } })];
    expect(validateRules(rules, [])).toEqual([]);
  });

  it('accepts a two-emoji badge — two code points, four UTF-16 units', () => {
    const rules = [rule({ verdict: { highlight: { badge: '🔥🔥' } } })];
    expect(validateRules(rules, [])).toEqual([]);
  });

  it('rejects a three-emoji badge — three code points is over the limit even by code points', () => {
    const rules = [rule({ verdict: { highlight: { badge: '🔥🔥🔥' } } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/highlight/badge' }),
    );
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

  it('reports propagate: true with neither color nor badge — nothing to raise on an ancestor', () => {
    const rules = [rule({ verdict: { highlight: { propagate: true, description: 'x' } } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/highlight/propagate' }),
    );
  });

  it('rejects propagate: true carried only by an empty/whitespace badge', () => {
    // A '' or ' ' badge is treated as no visible badge (same rule as the emptiness check above),
    // so it must not count as something for propagate to raise either.
    const rules = [rule({ verdict: { highlight: { propagate: true, badge: '  ' } } })];
    const diagnostics = validateRules(rules, []);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/highlight/propagate' }),
    );
  });

  it('accepts propagate: true backed by color', () => {
    const rules = [rule({ verdict: { highlight: { propagate: true, color: 'charts.red' } } })];
    expect(validateRules(rules, [])).toEqual([]);
  });

  it('accepts propagate: true backed by a visible badge', () => {
    const rules = [rule({ verdict: { highlight: { propagate: true, badge: '!' } } })];
    expect(validateRules(rules, [])).toEqual([]);
  });

  it('does not flag propagate: false/absent regardless of what else is set', () => {
    const rules = [rule({ verdict: { highlight: { description: 'x' } } })];
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
