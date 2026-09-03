import { describe, expect, it } from 'vitest';
import { toTreeItemLabel } from './label-highlight.js';

describe('toTreeItemLabel', () => {
  it('returns the plain name when there is no highlight, or labelHighlight is unset/false', () => {
    expect(toTreeItemLabel('name', undefined)).toBe('name');
    expect(toTreeItemLabel('name', {})).toBe('name');
    expect(toTreeItemLabel('name', { labelHighlight: false })).toBe('name');
  });

  it('returns a TreeItemLabel with a highlight range spanning the whole name', () => {
    const result = toTreeItemLabel('my-project', { labelHighlight: true });
    expect(result).toEqual({ label: 'my-project', highlights: [[0, 10]] });
  });

  it('the range end is exclusive and matches the name length exactly', () => {
    const result = toTreeItemLabel('abc', { labelHighlight: true });
    expect(typeof result).not.toBe('string');
    const label = result as { label: string; highlights: [number, number][] };
    expect(label.highlights).toEqual([[0, 3]]);
    const [start, end] = label.highlights[0] ?? [0, 0];
    expect(label.label.slice(start, end)).toBe('abc');
  });
});
