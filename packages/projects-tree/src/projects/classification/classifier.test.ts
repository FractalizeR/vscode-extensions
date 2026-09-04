import { describe, expect, it } from 'vitest';
import { createClassifier } from './classifier';
import type { DirEntry, NodeFacts } from './condition';
import type { Rule } from './rule';

function facts(overrides: Partial<NodeFacts> = {}): NodeFacts {
  return {
    rootId: 'root-1',
    absolutePath: '/home/dev/work/my-project',
    pathFromRoot: 'my-project',
    name: 'my-project',
    depthFromRoot: 1,
    entries: [],
    ...overrides,
  };
}

function entry(name: string, type: DirEntry['type'] = 'dir'): DirEntry {
  return { name, type };
}

describe('createClassifier — first-match per field', () => {
  it('resolves a field from the first enabled, matching rule that has an opinion about it', () => {
    const rules: Rule[] = [
      { id: 'first', when: { kind: 'nameMatches', pattern: '.*' }, verdict: { tags: ['first'] } },
      { id: 'second', when: { kind: 'nameMatches', pattern: '.*' }, verdict: { tags: ['second'] } },
    ];
    const verdict = createClassifier(rules).classify(facts());
    expect(verdict.tags).toEqual({ value: ['first'], byRule: 'first' });
  });

  it('skips a rule that matches but has no opinion about the field in question', () => {
    const rules: Rule[] = [
      {
        id: 'sets-skip-only',
        when: { kind: 'nameMatches', pattern: '.*' },
        verdict: { skip: false },
      },
      { id: 'sets-tags', when: { kind: 'nameMatches', pattern: '.*' }, verdict: { tags: ['x'] } },
    ];
    const verdict = createClassifier(rules).classify(facts());
    expect(verdict.tags).toEqual({ value: ['x'], byRule: 'sets-tags' });
  });

  it('skips a disabled rule even when it would otherwise win', () => {
    const rules: Rule[] = [
      {
        id: 'disabled',
        enabled: false,
        when: { kind: 'nameMatches', pattern: '.*' },
        verdict: { tags: ['from-disabled'] },
      },
      {
        id: 'enabled',
        when: { kind: 'nameMatches', pattern: '.*' },
        verdict: { tags: ['from-enabled'] },
      },
    ];
    const verdict = createClassifier(rules).classify(facts());
    expect(verdict.tags).toEqual({ value: ['from-enabled'], byRule: 'enabled' });
  });

  it('applies the engine default, with no byRule, when no rule has an opinion about a field', () => {
    // Boundary case: no rule speaks to a field.
    const rules: Rule[] = [
      { id: 'only-tags', when: { kind: 'nameMatches', pattern: '.*' }, verdict: { tags: ['x'] } },
    ];
    const verdict = createClassifier(rules).classify(facts());
    expect(verdict.project).toEqual({ value: false, byRule: undefined });
  });

  it('gives a node under both a highlight rule and a project rule both verdicts, independently', () => {
    /**
     * Regression: first-match by field, not by whole verdict or by a group of fields. A single
     * combined verdict (round 01) made highlighting and being a project mutually exclusive; a
     * later revision that grouped fields into "axes" reproduced the same defect one level down.
     * If first-match ever regresses to operate on the whole verdict (or a group) again, the
     * highlight rule below — which comes second and sets nothing else — would silently lose to
     * the project rule and this node would end up with no highlight.
     */
    const rules: Rule[] = [
      {
        id: 'is-project',
        when: { kind: 'hasChild', names: ['.git'] },
        verdict: { project: true, primaryAction: 'openFolder' },
      },
      {
        id: 'is-highlighted',
        when: { kind: 'nameMatches', pattern: '^my-' },
        verdict: { highlight: { color: 'blue' } },
      },
    ];
    const node = facts({ name: 'my-project', entries: [entry('.git')] });

    const verdict = createClassifier(rules).classify(node);

    expect(verdict.project).toEqual({ value: true, byRule: 'is-project' });
    expect(verdict.primaryAction).toEqual({ value: 'openFolder', byRule: 'is-project' });
    expect(verdict.highlight).toEqual({
      value: { color: 'blue' },
      byRule: 'is-highlighted',
    });
  });

  it('gives priority, within the skip field, to the rule protecting hidden repositories over the rule hiding dotfiles', () => {
    /**
     * Regression: "a hidden folder that is a repository" is the reason rule order within a field
     * matters. If the generic hidden-folder rule were ever allowed to win over the more specific
     * repository rule (e.g. by evaluating rules in the wrong order, or by a rule engine that
     * picked "most specific" instead of "first match"), a repository whose name happens to start
     * with a dot would vanish from the tree.
     */
    const rules: Rule[] = [
      {
        id: 'repo-stays-visible',
        when: { kind: 'hasChild', names: ['.git'] },
        verdict: { skip: false },
      },
      {
        id: 'hide-dotfiles',
        when: { kind: 'nameMatches', pattern: String.raw`^\.` },
        verdict: { skip: true },
      },
    ];
    const hiddenRepo = facts({ name: '.dotfiles-repo', entries: [entry('.git')] });

    const verdict = createClassifier(rules).classify(hiddenRepo);

    expect(verdict.skip).toEqual({ value: false, byRule: 'repo-stays-visible' });
  });
});

describe('createClassifier — normalization is applied to the resolved verdict', () => {
  it('resets other fields to their default once skip resolves to true', () => {
    const rules: Rule[] = [
      {
        id: 'skip-and-tag',
        when: { kind: 'nameMatches', pattern: '.*' },
        verdict: { skip: true, tags: ['should-not-surface'] },
      },
    ];
    const verdict = createClassifier(rules).classify(facts());
    expect(verdict.skip.value).toBe(true);
    expect(verdict.tags.value).toEqual([]);
    expect(verdict.tags.byRule).toBeUndefined();
  });
});

describe('createClassifier — HighlightSpec passthrough', () => {
  it('passes a HighlightSpec with only sortWeight set through unchanged', () => {
    // Boundary case: HighlightSpec with only sortWeight. Whether an "empty" decoration (no color/
    // badge/description/icon) should actually be created is a VS Code adapter concern (fact 7,
    // package 02-B/editor); the classification engine itself must not special-case it away.
    const rules: Rule[] = [
      {
        id: 'sort-only',
        when: { kind: 'nameMatches', pattern: '.*' },
        verdict: { highlight: { sortWeight: 5 } },
      },
    ];
    const verdict = createClassifier(rules).classify(facts());
    expect(verdict.highlight).toEqual({ value: { sortWeight: 5 }, byRule: 'sort-only' });
  });

  it('does not validate or truncate an over-long badge — that is package 02-B/the adapter', () => {
    // Boundary case: badge longer than two characters. VS Code's own FileDecoration validation
    // throws and drops the whole decoration when this happens (fact 7); rejecting it before it
    // reaches the adapter is 02-B's job. This engine must pass the value through so a future 02-B
    // validator has something to check.
    const rules: Rule[] = [
      {
        id: 'bad-badge',
        when: { kind: 'nameMatches', pattern: '.*' },
        verdict: { highlight: { badge: 'TOO-LONG' } },
      },
    ];
    const verdict = createClassifier(rules).classify(facts());
    expect(verdict.highlight.value).toEqual({ badge: 'TOO-LONG' });
  });
});

describe('createClassifier — inRoot / rootId', () => {
  it('lets a rule restrict itself to one root, so overlapping roots do not cross-apply rules', () => {
    const rules: Rule[] = [
      {
        id: 'root-1-only',
        when: {
          kind: 'all',
          of: [
            { kind: 'inRoot', rootId: 'root-1' },
            { kind: 'depth', min: 0, max: 0 },
          ],
        },
        verdict: { tags: ['root-1'] },
      },
    ];
    const classifier = createClassifier(rules);
    expect(classifier.classify(facts({ rootId: 'root-1', depthFromRoot: 0 })).tags.value).toEqual([
      'root-1',
    ]);
    expect(classifier.classify(facts({ rootId: 'root-2', depthFromRoot: 0 })).tags.value).toEqual(
      [],
    );
  });
});
