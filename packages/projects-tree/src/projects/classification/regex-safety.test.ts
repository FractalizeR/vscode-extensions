import { describe, expect, it } from 'vitest';
import { checkRegexComplexity } from './regex-safety';

describe('checkRegexComplexity', () => {
  it('accepts an ordinary anchored pattern', () => {
    expect(checkRegexComplexity('^node_modules$')).toEqual({ safe: true });
  });

  it('accepts a single quantifier with no nesting', () => {
    expect(checkRegexComplexity('a+b*c?')).toEqual({ safe: true });
  });

  it('accepts an unquantified group', () => {
    expect(checkRegexComplexity('(abc)+')).toEqual({ safe: true });
  });

  it('rejects a quantifier nested inside another quantifier — the DoD example (a+)+', () => {
    const result = checkRegexComplexity('(a+)+');
    expect(result.safe).toBe(false);
  });

  it('rejects (a*)+ and ([a-z]+)* the same way', () => {
    expect(checkRegexComplexity('(a*)+').safe).toBe(false);
    expect(checkRegexComplexity('([a-z]+)*').safe).toBe(false);
  });

  it('rejects nesting through a non-capturing group', () => {
    expect(checkRegexComplexity('(?:a+)+').safe).toBe(false);
  });

  it('rejects nesting several levels deep', () => {
    expect(checkRegexComplexity('((a+)b)+').safe).toBe(false);
  });

  it('rejects a numeric backreference', () => {
    expect(checkRegexComplexity(String.raw`(a)\1`).safe).toBe(false);
  });

  it('rejects a named backreference', () => {
    expect(checkRegexComplexity(String.raw`(?<x>a)\k<x>`).safe).toBe(false);
  });

  it('does not hang on unbalanced parentheses — a malformed pattern is a false negative, not a hang', () => {
    expect(() => checkRegexComplexity('(a+')).not.toThrow();
  });

  it('accepts a bounded repetition count with no nesting', () => {
    expect(checkRegexComplexity('a{2,4}').safe).toBe(true);
  });

  it('rejects a bounded repetition nested inside a quantified group', () => {
    expect(checkRegexComplexity('(a{2,4})+').safe).toBe(false);
  });

  describe('overlapping alternation under a quantifier', () => {
    it('rejects (a|aa)+ — measured at 61s on a 31-character input before this fix', () => {
      expect(checkRegexComplexity('(a|aa)+').safe).toBe(false);
    });

    it('rejects (a|a?)+ — the second branch shares its mandatory first atom with the first', () => {
      expect(checkRegexComplexity('(a|a?)+').safe).toBe(false);
    });

    it(String.raw`rejects (\d|\d\d)* — both branches start with the same escape atom`, () => {
      expect(checkRegexComplexity(String.raw`(\d|\d\d)*`).safe).toBe(false);
    });

    it('rejects the non-capturing form (?:a|a)*', () => {
      expect(checkRegexComplexity('(?:a|a)*').safe).toBe(false);
    });

    it('rejects an alternation branch that can match empty, e.g. (a|)+', () => {
      expect(checkRegexComplexity('(a|)+').safe).toBe(false);
    });

    it('accepts (foo|bar)+ — branches start with distinct atoms', () => {
      expect(checkRegexComplexity('(foo|bar)+').safe).toBe(true);
    });

    it('accepts (a|b)* — branches start with distinct atoms', () => {
      expect(checkRegexComplexity('(a|b)*').safe).toBe(true);
    });

    it('does not flag alternation with no quantifier on the group at all', () => {
      expect(checkRegexComplexity('(a|aa)').safe).toBe(true);
    });

    it('does not flag alternation whose group is not itself quantified, even nested in one that is', () => {
      // The overlap only matters for the group the quantifier is actually attached to.
      expect(checkRegexComplexity('((a|aa)b)+').safe).toBe(true);
    });

    it('is not fooled by a case actually measured to hang: (a|a)* over a long non-matching input', () => {
      const start = performance.now();
      const result = checkRegexComplexity('^(?:a|a)*$');
      const elapsedMs = performance.now() - start;
      expect(result.safe).toBe(false);
      expect(elapsedMs).toBeLessThan(1000);
    });
  });
});
