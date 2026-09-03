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
});
