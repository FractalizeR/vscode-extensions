import { describe, expect, it } from 'vitest';
import { compileCondition, type Condition, type DirEntry, type NodeFacts } from './condition';

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

function isConditionMet(condition: Condition, input: NodeFacts): boolean {
  return compileCondition(condition)(input);
}

describe('nameMatches', () => {
  it('matches the node name against the pattern', () => {
    const named = facts({ name: 'my-project' });
    const other = facts({ name: 'other' });
    expect(isConditionMet({ kind: 'nameMatches', pattern: '^my-' }, named)).toBe(true);
    expect(isConditionMet({ kind: 'nameMatches', pattern: '^my-' }, other)).toBe(false);
  });

  it('applies flags, e.g. case-insensitive matching', () => {
    const node = facts({ name: 'MY-project' });
    const condition: Condition = { kind: 'nameMatches', pattern: '^my-', flags: 'i' };
    expect(isConditionMet(condition, node)).toBe(true);
  });

  it('matches a name that is itself full of regex special characters literally escaped by the caller', () => {
    // Boundary case from the plan: "имя со спецсимволами regex". The condition's pattern is a
    // regex the rule author writes; a *node name* containing regex metacharacters must still be
    // matched as a plain string subject, not interpreted.
    const name = 'a(weird).name+[v2]';
    const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const condition: Condition = { kind: 'nameMatches', pattern: `^${escaped}$` };
    const node = facts({ name });
    expect(isConditionMet(condition, node)).toBe(true);
  });

  it('throws at compile time on an invalid pattern, rather than swallowing the error', () => {
    expect(() => compileCondition({ kind: 'nameMatches', pattern: '[' })).toThrow();
  });

  it('is not corrupted by RegExp statefulness when the pattern carries a "g" flag', () => {
    // Regression: a compiled predicate is reused across many nodes (that's the whole point of
    // compiling once). A stateful "g"/"y" regex whose lastIndex is not reset would alternately
    // match and miss on successive, identical calls.
    const predicate = compileCondition({ kind: 'nameMatches', pattern: 'project', flags: 'g' });
    const node = facts({ name: 'my-project' });
    expect(predicate(node)).toBe(true);
    expect(predicate(node)).toBe(true);
    expect(predicate(node)).toBe(true);
  });
});

describe('hasChild', () => {
  it('matches when one of the named entries is present', () => {
    const condition: Condition = { kind: 'hasChild', names: ['.git', '.idea'] };
    const withGit = facts({ entries: [entry('.git', 'dir')] });
    const withoutGit = facts({ entries: [entry('src', 'dir')] });
    expect(isConditionMet(condition, withGit)).toBe(true);
    expect(isConditionMet(condition, withoutGit)).toBe(false);
  });

  it('does not match on an empty directory', () => {
    // Boundary case: empty directory.
    const condition: Condition = { kind: 'hasChild', names: ['.git'] };
    expect(isConditionMet(condition, facts({ entries: [] }))).toBe(false);
  });

  it('treats a directory unreadable to the walker the same as an empty one', () => {
    // Boundary case: no read permission. From classification's point of view an unreadable
    // directory and an empty one are indistinguishable — both surface as entries: []; distinguishing
    // them, if ever needed, is discovery's concern, not this layer's.
    const condition: Condition = { kind: 'hasChild', names: ['.git'] };
    expect(isConditionMet(condition, facts({ entries: [] }))).toBe(false);
  });

  it('filters by entry type when entryType is given', () => {
    const condition: Condition = { kind: 'hasChild', names: ['x'], entryType: 'dir' };
    const asFile = facts({ entries: [entry('x', 'file')] });
    const asDir = facts({ entries: [entry('x', 'dir')] });
    expect(isConditionMet(condition, asFile)).toBe(false);
    expect(isConditionMet(condition, asDir)).toBe(true);
  });

  it('defaults entryType to "any", including symlinks', () => {
    const condition: Condition = { kind: 'hasChild', names: ['.git'] };
    const node = facts({ entries: [entry('.git', 'symlink')] });
    expect(isConditionMet(condition, node)).toBe(true);
  });

  it('does not resolve a symlink to its target type — "dir" does not match a symlinked dir', () => {
    // Boundary case: symlink (including, conceptually, a cyclic one — cycle *detection* is the
    // walker's job; classification only ever sees the DirEntry it is handed). A symlink is its own
    // DirEntry.type, distinct from the type it points at.
    const condition: Condition = { kind: 'hasChild', names: ['linked'], entryType: 'dir' };
    const linkToDir: DirEntry = {
      name: 'linked',
      type: 'symlink',
      symlinkTarget: { type: 'dir' },
    };
    const node = facts({ entries: [linkToDir] });
    expect(isConditionMet(condition, node)).toBe(false);
  });

  it('matches names case-sensitively, independent of the underlying filesystem casing', () => {
    // Boundary case: case-insensitive filesystem (macOS default). The OS may report ".Git" or
    // ".git" depending on how the entry was created, but classification must not second-guess
    // case — otherwise its behavior would silently depend on the host filesystem.
    const condition: Condition = { kind: 'hasChild', names: ['.git'] };
    const capitalized = facts({ entries: [entry('.Git')] });
    const lowercase = facts({ entries: [entry('.git')] });
    expect(isConditionMet(condition, capitalized)).toBe(false);
    expect(isConditionMet(condition, lowercase)).toBe(true);
  });
});

describe('depth', () => {
  it('matches inclusive of both bounds', () => {
    const condition: Condition = { kind: 'depth', min: 1, max: 2 };
    expect(isConditionMet(condition, facts({ depthFromRoot: 0 }))).toBe(false);
    expect(isConditionMet(condition, facts({ depthFromRoot: 1 }))).toBe(true);
    expect(isConditionMet(condition, facts({ depthFromRoot: 2 }))).toBe(true);
    expect(isConditionMet(condition, facts({ depthFromRoot: 3 }))).toBe(false);
  });

  it('treats an omitted bound as unbounded on that side', () => {
    expect(isConditionMet({ kind: 'depth', min: 2 }, facts({ depthFromRoot: 100 }))).toBe(true);
    expect(isConditionMet({ kind: 'depth', max: 2 }, facts({ depthFromRoot: 0 }))).toBe(true);
  });

  it('matches the root itself at depth 0', () => {
    // Boundary case: root depth (= 0).
    const condition: Condition = { kind: 'depth', min: 0, max: 0 };
    expect(isConditionMet(condition, facts({ depthFromRoot: 0 }))).toBe(true);
  });
});

describe('pathMatches', () => {
  it('anchors on pathFromRoot by default', () => {
    const condition: Condition = { kind: 'pathMatches', glob: 'libs/*/src' };
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libs/foo/src' }))).toBe(true);
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libs/foo/bar/src' }))).toBe(false);
  });

  it('matches zero or more segments with ** — the standard .gitignore/minimatch meaning', () => {
    const condition: Condition = { kind: 'pathMatches', glob: 'libs/**/src' };
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libs/src' }))).toBe(true);
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libs/foo/src' }))).toBe(true);
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libs/foo/bar/src' }))).toBe(true);
  });

  it('matches the segment itself when ** is trailing, with no children required', () => {
    const condition: Condition = { kind: 'pathMatches', glob: 'libs/**' };
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libs' }))).toBe(true);
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libs/foo' }))).toBe(true);
  });

  it('does not match past a segment boundary when ** is trailing', () => {
    // Regression: `libs(?:.*/)?` (the pre-fix middle-** fragment reused here) would have matched
    // 'libsX' as a bare prefix — `**` must match whole segments only.
    const condition: Condition = { kind: 'pathMatches', glob: 'libs/**' };
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libsX' }))).toBe(false);
  });

  it('does not match past a segment boundary when ** is in the middle', () => {
    // Regression: `libs(?:.*/)?src` (the actual pre-fix compiled form) matched 'libsX/src' and
    // 'libs-extra/a/src' — ** swallowed the boundary slash instead of requiring the preceding and
    // following literals to each be whole segments.
    const condition: Condition = { kind: 'pathMatches', glob: 'libs/**/src' };
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libsX/src' }))).toBe(false);
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libs-extra/a/src' }))).toBe(false);
    // Zero '**' segments must still require the separating slash — not merge the two literals.
    expect(isConditionMet(condition, facts({ pathFromRoot: 'libssrc' }))).toBe(false);
  });

  it('does not match past a segment boundary when ** is leading', () => {
    const condition: Condition = { kind: 'pathMatches', glob: '**/b' };
    expect(isConditionMet(condition, facts({ pathFromRoot: 'ab' }))).toBe(false);
    expect(isConditionMet(condition, facts({ pathFromRoot: 'aXb' }))).toBe(false);
  });

  it('generalizes the segment-boundary regression from a/**/b vs aXX/b', () => {
    const condition: Condition = { kind: 'pathMatches', glob: 'a/**/b' };
    expect(isConditionMet(condition, facts({ pathFromRoot: 'aXX/b' }))).toBe(false);
    expect(isConditionMet(condition, facts({ pathFromRoot: 'a/b' }))).toBe(true);
  });

  it('anchors on absolutePath, normalized to forward slashes, when anchor is "absolute"', () => {
    const condition: Condition = {
      kind: 'pathMatches',
      glob: '/home/dev/**/my-project',
      anchor: 'absolute',
    };
    const windowsStyle = 'home/dev/work/my-project'.replaceAll('/', '\\');
    const node = facts({ absolutePath: `\\${windowsStyle}` });
    expect(isConditionMet(condition, node)).toBe(true);
  });
});

describe('pathEquals', () => {
  it('matches pathFromRoot exactly', () => {
    const condition: Condition = { kind: 'pathEquals', path: 'docs/README.md' };
    expect(isConditionMet(condition, facts({ pathFromRoot: 'docs/README.md' }))).toBe(true);
    expect(isConditionMet(condition, facts({ pathFromRoot: 'docs/readme.md' }))).toBe(false);
  });
});

describe('inRoot', () => {
  it('matches by rootId, ignoring path', () => {
    const condition: Condition = { kind: 'inRoot', rootId: 'root-1' };
    expect(isConditionMet(condition, facts({ rootId: 'root-1' }))).toBe(true);
    expect(isConditionMet(condition, facts({ rootId: 'root-2' }))).toBe(false);
  });
});

describe('combinators', () => {
  const atRootDepth: Condition = { kind: 'depth', min: 0, max: 0 };
  const nameA: Condition = { kind: 'nameMatches', pattern: '^a' };
  const nameB: Condition = { kind: 'nameMatches', pattern: '^b' };

  it('all requires every child condition to match', () => {
    const condition: Condition = { kind: 'all', of: [atRootDepth, nameA] };
    expect(isConditionMet(condition, facts({ depthFromRoot: 0, name: 'a-root' }))).toBe(true);
    expect(isConditionMet(condition, facts({ depthFromRoot: 1, name: 'a-root' }))).toBe(false);
  });

  it('any requires at least one child condition to match', () => {
    const condition: Condition = { kind: 'any', of: [nameA, nameB] };
    expect(isConditionMet(condition, facts({ name: 'b-thing' }))).toBe(true);
    expect(isConditionMet(condition, facts({ name: 'c-thing' }))).toBe(false);
  });

  it('not matches when none of the child conditions match', () => {
    const condition: Condition = { kind: 'not', of: [nameA, nameB] };
    expect(isConditionMet(condition, facts({ name: 'c-thing' }))).toBe(true);
    expect(isConditionMet(condition, facts({ name: 'a-thing' }))).toBe(false);
  });

  it('nests combinators', () => {
    const condition: Condition = {
      kind: 'all',
      of: [atRootDepth, { kind: 'not', of: [nameB] }],
    };
    expect(isConditionMet(condition, facts({ depthFromRoot: 0, name: 'a-root' }))).toBe(true);
    expect(isConditionMet(condition, facts({ depthFromRoot: 0, name: 'b-root' }))).toBe(false);
  });
});
