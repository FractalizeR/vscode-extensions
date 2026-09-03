import { describe, expect, it } from 'vitest';
import { DEFAULT_VERDICT, normalizeVerdict, type Verdict } from './verdict';

function fullyClaimedVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    skip: { value: false, byRule: 'r-skip' },
    stopDescend: { value: true, byRule: 'r-stop' },
    project: { value: true, byRule: 'r-project' },
    primaryAction: { value: 'open', byRule: 'r-action' },
    highlight: { value: { color: 'red' }, byRule: 'r-highlight' },
    tags: { value: ['important'], byRule: 'r-tags' },
    ...overrides,
  };
}

describe('normalizeVerdict', () => {
  it('leaves a fully-claimed, mutually-consistent verdict untouched', () => {
    const verdict = fullyClaimedVerdict();
    expect(normalizeVerdict(verdict)).toEqual(verdict);
  });

  it('resets stopDescend, project, primaryAction, highlight and tags to the default when skip is true', () => {
    // Regression: skip: true nullifies the significance of every other field — a rule that also
    // set e.g. `tags` on a skipped node must not leak that opinion into the result.
    const verdict = fullyClaimedVerdict({ skip: { value: true, byRule: 'r-skip' } });

    const result = normalizeVerdict(verdict);

    expect(result.skip).toEqual({ value: true, byRule: 'r-skip' });
    expect(result.stopDescend).toEqual(DEFAULT_VERDICT.stopDescend);
    expect(result.project).toEqual(DEFAULT_VERDICT.project);
    expect(result.primaryAction).toEqual(DEFAULT_VERDICT.primaryAction);
    expect(result.highlight).toEqual(DEFAULT_VERDICT.highlight);
    expect(result.tags).toEqual(DEFAULT_VERDICT.tags);
  });

  it('resets primaryAction to the default when project is false, independent of skip', () => {
    const verdict = fullyClaimedVerdict({ project: { value: false, byRule: 'r-project' } });

    const result = normalizeVerdict(verdict);

    expect(result.primaryAction).toEqual(DEFAULT_VERDICT.primaryAction);
    // project itself, and unrelated fields, are untouched by this rule.
    expect(result.tags).toEqual(verdict.tags);
    expect(result.highlight).toEqual(verdict.highlight);
  });

  it('does not attribute a reset field to the rule whose claim no longer applies', () => {
    const verdict = fullyClaimedVerdict({ skip: { value: true, byRule: 'r-skip' } });
    const result = normalizeVerdict(verdict);
    expect(result.tags.byRule).toBeUndefined();
  });
});
