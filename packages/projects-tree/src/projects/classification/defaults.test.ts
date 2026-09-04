import { describe, expect, it } from 'vitest';
import { createClassifier } from './classifier';
import type { DirEntry, NodeFacts } from './condition';
import { DEFAULT_RULES } from './defaults';
import { validateRules } from './validation';

function facts(overrides: Partial<NodeFacts> = {}): NodeFacts {
  return {
    rootId: 'root-1',
    absolutePath: '/home/dev/work/node',
    pathFromRoot: 'node',
    name: 'node',
    depthFromRoot: 1,
    entries: [],
    ...overrides,
  };
}

function entry(name: string, type: DirEntry['type'] = 'dir'): DirEntry {
  return { name, type };
}

describe('DEFAULT_RULES', () => {
  it('passes domain validation with no diagnostics', () => {
    expect(validateRules(DEFAULT_RULES, [])).toEqual([]);
  });

  it('classifies a plain directory as neither project nor skipped', () => {
    const classifier = createClassifier(DEFAULT_RULES);
    const verdict = classifier.classify(facts({ name: 'src' }));
    expect(verdict.project.value).toBe(false);
    expect(verdict.skip.value).toBe(false);
  });

  it('marks a directory with a .git subdirectory as a project and stops descent', () => {
    const classifier = createClassifier(DEFAULT_RULES);
    const verdict = classifier.classify(facts({ name: 'repo', entries: [entry('.git', 'dir')] }));
    expect(verdict.project.value).toBe(true);
    expect(verdict.stopDescend.value).toBe(true);
    expect(verdict.skip.value).toBe(false);
  });

  it('recognizes a submodule, whose .git is a file, as a project too', () => {
    // Regression: a naive entryType:'dir' marker condition would miss this. The prototype's
    // .git-folder check could not see a submodule at all (docs/plans/projects-tree/02-core.md,
    // package 02-B: "маркер любого типа").
    const classifier = createClassifier(DEFAULT_RULES);
    const verdict = classifier.classify(
      facts({ name: 'vendor-lib', entries: [entry('.git', 'file')] }),
    );
    expect(verdict.project.value).toBe(true);
  });

  it('marks a directory with an .idea subdirectory as a project', () => {
    const classifier = createClassifier(DEFAULT_RULES);
    const verdict = classifier.classify(
      facts({ name: 'ide-project', entries: [entry('.idea', 'dir')] }),
    );
    expect(verdict.project.value).toBe(true);
  });

  it('skips the prototype ignoreFolders defaults', () => {
    const classifier = createClassifier(DEFAULT_RULES);
    for (const name of ['node_modules', 'bin', 'obj', 'dist', '.vs', '.vscode']) {
      expect(classifier.classify(facts({ name })).skip.value).toBe(true);
    }
  });

  it('skips an ordinary hidden folder', () => {
    const classifier = createClassifier(DEFAULT_RULES);
    expect(classifier.classify(facts({ name: '.env-configs' })).skip.value).toBe(true);
  });

  it('a hidden folder that is itself a repository is a node and a project, not skipped', () => {
    // Regression: this is the case the rule order exists for (docs/plans/projects-tree/02-core.md,
    // "skip для скрытых папок строго ниже правила, оставляющего видимые репозитории"). Reversing
    // 'repo-marker' and 'hidden-folders' in DEFAULT_RULES turns this red — see the break/red/revert
    // proof in the session report.
    const classifier = createClassifier(DEFAULT_RULES);
    const verdict = classifier.classify(
      facts({ name: '.dotfiles', entries: [entry('.git', 'dir')] }),
    );
    expect(verdict.skip.value).toBe(false);
    expect(verdict.project.value).toBe(true);
  });
});
