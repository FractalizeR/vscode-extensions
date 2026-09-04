import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, createClassifier } from '../../projects/classification/index.js';
import { loadCanonicalRules, rulesFilePath, RULES_FILE_NAME } from './canonical-rules.js';

const state: { storageDir: string } = { storageDir: '' };

beforeEach(async () => {
  state.storageDir = await mkdtemp(nodePath.join(tmpdir(), 'projects-tree-rules-'));
});

afterEach(async () => {
  await rm(state.storageDir, { recursive: true, force: true });
});

function location(): { globalStorageUri: { fsPath: string } } {
  return { globalStorageUri: { fsPath: state.storageDir } };
}

describe('rulesFilePath', () => {
  it('joins globalStorageUri.fsPath with the canonical file name', () => {
    expect(rulesFilePath(location())).toBe(nodePath.join(state.storageDir, RULES_FILE_NAME));
  });
});

describe('loadCanonicalRules', () => {
  it(// Regression for codex-02 (review-06): production never called loadRulesFile at all, so a
  // highlight rule saved to disk could never reach a real Verdict — this proves the full path,
  // disk -> loadCanonicalRules -> createClassifier -> Verdict.highlight, actually works.
  'reaches a real Verdict.highlight from a rules file saved on disk', async () => {
    const raw = {
      version: 1,
      rules: [
        {
          id: 'flag-scratch',
          when: { kind: 'nameMatches', pattern: '^scratch$' },
          // eslint-disable-next-line unicorn/no-thenable -- on-disk key, see rules-file.ts.
          then: { highlight: { badge: '!', color: 'charts.red' } },
        },
      ],
    };
    await writeFile(rulesFilePath(location()), JSON.stringify(raw), 'utf8');

    const { rules, diagnostics } = await loadCanonicalRules(location());
    expect(diagnostics).toEqual([]);

    const verdict = createClassifier(rules).classify({
      rootId: 'root-1',
      absolutePath: '/work/scratch',
      pathFromRoot: 'scratch',
      name: 'scratch',
      depthFromRoot: 1,
      entries: [],
    });
    expect(verdict.highlight.value).toEqual({ badge: '!', color: 'charts.red' });
    expect(verdict.highlight.byRule).toBe('flag-scratch');
  });

  it('falls back to DEFAULT_RULES with no diagnostics when the file does not exist', async () => {
    const result = await loadCanonicalRules(location());
    expect(result).toEqual({ rules: DEFAULT_RULES, actions: [], diagnostics: [] });
  });

  it('falls back to DEFAULT_RULES, with diagnostics, for invalid JSON — never throws', async () => {
    await writeFile(rulesFilePath(location()), '{ not json', 'utf8');

    const { rules, diagnostics } = await loadCanonicalRules(location());
    expect(rules).toBe(DEFAULT_RULES);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/invalid JSON/);
  });

  it('falls back to DEFAULT_RULES, with diagnostics, for content that fails domain validation', async () => {
    const raw = {
      version: 1,
      rules: [
        {
          id: 'dup',
          when: { kind: 'nameMatches', pattern: 'x' },
          // eslint-disable-next-line unicorn/no-thenable -- on-disk key, see rules-file.ts.
          then: {},
        },
        {
          id: 'dup',
          when: { kind: 'nameMatches', pattern: 'y' },
          // eslint-disable-next-line unicorn/no-thenable -- on-disk key, see rules-file.ts.
          then: {},
        },
      ],
    };
    await writeFile(rulesFilePath(location()), JSON.stringify(raw), 'utf8');

    const { rules, diagnostics } = await loadCanonicalRules(location());
    expect(rules).toBe(DEFAULT_RULES);
    expect(diagnostics.some((d) => d.message.includes('duplicate rule id'))).toBe(true);
  });

  /**
  Regression for the stage-03 debt this module's own doc comment named: production called
  `loadCanonicalRules` with no `knownActionIds` at all, so a rule's `primaryAction` could reference
  only an action the file itself declared — a reference to a built-in id (never passed in) was
  rejected as unknown, even though the composition root wires the same built-in into every action
  registry. Passing the id here is what package 04-C's `extension.ts` now does with
  `BUILT_IN_ACTIONS.map(a => a.id)`.
  */
  it('accepts a primaryAction referencing an id supplied via knownActionIds, not declared by the file', async () => {
    const raw = {
      version: 1,
      rules: [
        {
          id: 'open-in-new-window',
          when: { kind: 'nameMatches', pattern: '^app$' },
          // eslint-disable-next-line unicorn/no-thenable -- on-disk key, see rules-file.ts.
          then: { primaryAction: 'builtin.openInNewWindow' },
        },
      ],
    };
    await writeFile(rulesFilePath(location()), JSON.stringify(raw), 'utf8');

    const { rules, diagnostics } = await loadCanonicalRules(location(), [
      'builtin.openInNewWindow',
    ]);

    expect(diagnostics).toEqual([]);
    expect(rules[0]?.id).toBe('open-in-new-window');
  });

  it('surfaces the file-declared actions alongside the rules, not just their ids', async () => {
    const raw = {
      version: 1,
      rules: [],
      actions: [
        { id: 'custom.opencode', spec: { kind: 'terminal', command: 'opencode', shell: 'zsh' } },
      ],
    };
    await writeFile(rulesFilePath(location()), JSON.stringify(raw), 'utf8');

    const { actions, diagnostics } = await loadCanonicalRules(location());

    expect(diagnostics).toEqual([]);
    expect(actions).toEqual(raw.actions);
  });

  it('reports, rather than throws, when the path is unreadable for a reason other than absence', async () => {
    // A directory at the rules file's own path: readFile on it rejects with EISDIR, not ENOENT —
    // exercises the "exists but unreadable" branch distinct from both "absent" and "malformed JSON".
    const { mkdir } = await import('node:fs/promises');
    await mkdir(rulesFilePath(location()));

    const { rules, diagnostics } = await loadCanonicalRules(location());
    expect(rules).toBe(DEFAULT_RULES);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toMatch(/could not read rules file/);
  });
});

describe('layering over the defaults', () => {
  /**
  Substituting the user's rules for the defaults means a file with one `highlight` rule also drops
  `repo-marker`, so nothing is a project and nothing stops the descent. Found by a run over a real
  directory tree (181 nodes → 1865, 151 projects → 0) after the whole unit suite stayed green.
  */
  // `then` is the key the user-facing rules FILE uses; internally the same field is `verdict`,
  // precisely because an object carrying `then` is thenable and `await`ing one would misbehave
  // (docs/plans/projects-tree/00-overview.md, "Ключевая модель данных"). These fixtures are file
  // content, so they must spell it the way the file does.
  /* eslint-disable unicorn/no-thenable */
  it('keeps the default rules underneath the user rules', async () => {
    await writeFile(
      rulesFilePath(location()),
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: 'user-highlight',
            when: { kind: 'depth', max: 1 },
            then: { highlight: { badge: '!' } },
          },
        ],
      }),
      'utf8',
    );

    const { rules, diagnostics } = await loadCanonicalRules(location());

    expect(diagnostics).toEqual([]);
    expect(rules.map((rule) => rule.id)).toEqual([
      'user-highlight',
      ...DEFAULT_RULES.map((rule) => rule.id),
    ]);
  });

  /**
  Order is the whole mechanism: first-match per field means the user rule must come first, or the
  defaults would claim `skip`/`project` before it is ever consulted.
  */
  it('puts the user rules first, so they win the fields they claim', async () => {
    await writeFile(
      rulesFilePath(location()),
      JSON.stringify({
        version: 1,
        rules: [
          {
            id: 'keep-node-modules',
            when: { kind: 'nameMatches', pattern: '^node_modules$' },
            then: { skip: false },
          },
        ],
      }),
      'utf8',
    );

    const { rules } = await loadCanonicalRules(location());

    expect(rules[0]?.id).toBe('keep-node-modules');
    expect(rules.findIndex((rule) => rule.id === 'ignored-folders')).toBeGreaterThan(0);
  });
});
/* eslint-enable unicorn/no-thenable */
