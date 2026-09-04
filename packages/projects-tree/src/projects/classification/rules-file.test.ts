/* eslint-disable unicorn/no-thenable -- fixtures below deliberately use the on-disk `then` key
   throughout (see rules-file.ts's RawRule doc comment) — plain data literals describing JSON file
   content, never awaited. */

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import rulesSchema from '../../../schemas/rules.schema.json';
import { DEFAULT_RULES } from './defaults';
import {
  checkExternalModification,
  CURRENT_RULES_FILE_VERSION,
  loadRulesFile,
  toRawRulesFile,
} from './rules-file';

const VALID_MINIMAL = {
  version: 1,
  rules: [{ id: 'r1', when: { kind: 'nameMatches', pattern: '^src$' }, then: { skip: true } }],
};

/**
 * Fixtures shared between the "raw schema, via a fresh ajv instance" tests below and the
 * `loadRulesFile` tests further down — the same invalid body must be rejected by both, since
 * `loadRulesFile` validates against this exact schema file (rules-file.ts) and there must be no way
 * for the schema to accept something the loader's own compiled validator, built from a *different*
 * Ajv instance here, would reject (or vice versa). Each case names the one thing wrong with it.
 */
const INVALID_FIXTURES: readonly { readonly name: string; readonly body: unknown }[] = [
  {
    name: 'unknown condition kind',
    body: { version: 1, rules: [{ id: 'r1', when: { kind: 'bogus' }, then: {} }] },
  },
  {
    name: 'skip as a string instead of boolean',
    body: {
      version: 1,
      rules: [{ id: 'r1', when: { kind: 'nameMatches', pattern: 'x' }, then: { skip: 'yes' } }],
    },
  },
  {
    name: 'when without kind',
    body: { version: 1, rules: [{ id: 'r1', when: { pattern: 'x' }, then: {} }] },
  },
  {
    name: 'extra property on a rule, rejected by additionalProperties: false',
    body: {
      version: 1,
      rules: [{ id: 'r1', when: { kind: 'nameMatches', pattern: 'x' }, then: {}, extra: true }],
    },
  },
  {
    name: 'extra property on a condition',
    body: {
      version: 1,
      rules: [{ id: 'r1', when: { kind: 'nameMatches', pattern: 'x', bogus: 1 }, then: {} }],
    },
  },
  {
    name: 'badge longer than two characters',
    body: {
      version: 1,
      rules: [
        {
          id: 'r1',
          when: { kind: 'nameMatches', pattern: 'x' },
          then: { highlight: { badge: 'ABC' } },
        },
      ],
    },
  },
  {
    name: 'missing required "when"',
    body: { version: 1, rules: [{ id: 'r1', then: {} }] },
  },
  {
    name: 'missing required "rules"',
    body: { version: 1 },
  },
  {
    name: 'unrecognized version',
    body: { version: 2, rules: [] },
  },
  {
    name: 'action with an unknown kind',
    body: {
      version: 1,
      rules: [],
      actions: [{ id: 'a1', spec: { kind: 'bogus' } }],
    },
  },
  {
    name: 'action missing a required key (terminal spec without shell)',
    body: {
      version: 1,
      rules: [],
      actions: [{ id: 'a1', spec: { kind: 'terminal', command: 'ls' } }],
    },
  },
  {
    name: 'action spec with an extra property, rejected by additionalProperties: false',
    body: {
      version: 1,
      rules: [],
      actions: [{ id: 'a1', spec: { kind: 'openFolder', window: 'current', bogus: true } }],
    },
  },
];

describe('rules.schema.json, validated directly by a fresh ajv instance', () => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(rulesSchema);

  it('accepts a minimal valid rules file', () => {
    expect(validate(VALID_MINIMAL)).toBe(true);
  });

  it('accepts the default rule set, serialized to its on-disk form', () => {
    const raw = toRawRulesFile(DEFAULT_RULES);
    expect(validate(raw)).toBe(true);
  });

  for (const fixture of INVALID_FIXTURES) {
    it(`rejects: ${fixture.name}`, () => {
      expect(validate(fixture.body)).toBe(false);
    });
  }
});

describe('loadRulesFile', () => {
  it('loads the default rule set round-tripped through its on-disk form with no diagnostics', () => {
    const content = JSON.stringify(toRawRulesFile(DEFAULT_RULES));
    const result = loadRulesFile(content, []);
    expect(result.diagnostics).toEqual([]);
    expect(result.file?.version).toBe(CURRENT_RULES_FILE_VERSION);
    expect(result.file?.rules).toHaveLength(DEFAULT_RULES.length);
  });

  it('maps "then" to "verdict" and null to undefined for primaryAction/highlight', () => {
    const content = JSON.stringify({
      version: 1,
      rules: [
        {
          id: 'r1',
          when: { kind: 'nameMatches', pattern: '^x$' },
          then: { project: true, primaryAction: null, highlight: null },
        },
      ],
    });
    const result = loadRulesFile(content, []);
    expect(result.diagnostics).toEqual([]);
    const [loaded] = result.file?.rules ?? [];
    expect(loaded?.verdict).toEqual({
      project: true,
      primaryAction: undefined,
      highlight: undefined,
    });
  });

  it('rejects invalid JSON with a diagnostic, not a throw', () => {
    const result = loadRulesFile('{ not json', []);
    expect(result.file).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
  });

  for (const fixture of INVALID_FIXTURES) {
    it(`rejects, with diagnostics: ${fixture.name}`, () => {
      const result = loadRulesFile(JSON.stringify(fixture.body), []);
      expect(result.file).toBeUndefined();
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  }

  it('gives every structural diagnostic at once for a file with several independent problems', () => {
    const content = JSON.stringify({
      version: 1,
      rules: [
        { id: 'r1', when: { kind: 'bogus' }, then: {} },
        { id: 'r2', when: { kind: 'nameMatches', pattern: 'x' }, then: { skip: 'yes' } },
      ],
    });
    const result = loadRulesFile(content, []);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a reference to an unknown action id, after structural validation passes', () => {
    const content = JSON.stringify({
      version: 1,
      rules: [
        {
          id: 'r1',
          when: { kind: 'nameMatches', pattern: '^x$' },
          then: { project: true, primaryAction: 'no-such-action' },
        },
      ],
    });
    const result = loadRulesFile(content, ['known-action']);
    expect(result.file).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/then/primaryAction' }),
    );
  });

  it('rejects an uncompilable regex pattern with a diagnostic, not a throw, and does not load a file', () => {
    // Regression: this used to load with zero diagnostics, leaving a SyntaxError to surface much
    // later — out of `compileCondition`, during a walk — instead of at load time.
    const content = JSON.stringify({
      version: 1,
      rules: [{ id: 'r1', when: { kind: 'nameMatches', pattern: '(' }, then: { skip: true } }],
    });
    let result: ReturnType<typeof loadRulesFile> | undefined;
    expect(() => {
      result = loadRulesFile(content, []);
    }).not.toThrow();
    expect(result?.file).toBeUndefined();
    expect(result?.diagnostics).toContainEqual(
      expect.objectContaining({ path: '/rules/0/when/pattern' }),
    );
  });

  it('accepts the same reference once the action id is known', () => {
    const content = JSON.stringify({
      version: 1,
      rules: [
        {
          id: 'r1',
          when: { kind: 'nameMatches', pattern: '^x$' },
          then: { project: true, primaryAction: 'known-action' },
        },
      ],
    });
    const result = loadRulesFile(content, ['known-action']);
    expect(result.diagnostics).toEqual([]);
  });

  describe('actions declared in the canonical file', () => {
    // Regression: before this fix, RawRulesFile had no `actions` key at all — a user had nowhere
    // to declare a custom action, and `primaryAction` could only ever reference an id the *caller*
    // supplied from outside the file.
    it('lets a rule reference an action declared in the same file, with no external knownActionIds', () => {
      const content = JSON.stringify({
        version: 1,
        rules: [
          {
            id: 'r1',
            when: { kind: 'nameMatches', pattern: '^x$' },
            then: { project: true, primaryAction: 'open-terminal' },
          },
        ],
        actions: [
          {
            id: 'open-terminal',
            spec: { kind: 'terminal', command: 'echo hi', shell: 'zsh' },
          },
        ],
      });
      const result = loadRulesFile(content, []);
      expect(result.diagnostics).toEqual([]);
      expect(result.file?.actions).toHaveLength(1);
    });

    it('still rejects a reference to neither a declared action nor a knownActionIds entry', () => {
      const content = JSON.stringify({
        version: 1,
        rules: [
          {
            id: 'r1',
            when: { kind: 'nameMatches', pattern: '^x$' },
            then: { project: true, primaryAction: 'no-such-action' },
          },
        ],
        actions: [
          { id: 'open-terminal', spec: { kind: 'terminal', command: 'echo hi', shell: 'zsh' } },
        ],
      });
      const result = loadRulesFile(content, []);
      expect(result.file).toBeUndefined();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ path: '/rules/0/then/primaryAction' }),
      );
    });

    it('reports a duplicate action id', () => {
      const content = JSON.stringify({
        version: 1,
        rules: [],
        actions: [
          { id: 'dup', spec: { kind: 'openFolder', window: 'current' } },
          { id: 'dup', spec: { kind: 'openFolder', window: 'new' } },
        ],
      });
      const result = loadRulesFile(content, []);
      expect(result.file).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ path: '/actions/1/id' }));
    });

    it('loads with an empty actions array when the file declares none', () => {
      const result = loadRulesFile(JSON.stringify(VALID_MINIMAL), []);
      expect(result.file?.actions).toEqual([]);
    });

    it('rejects an uncompilable appliesTo pattern with a diagnostic, not a throw', () => {
      // R07-ACTION-CONDITION: appliesTo is a Condition too, but lives on RawActionDefinition, a
      // shape validateRules (which only walks rules[]) never sees — before this fix an invalid
      // appliesTo loaded with zero diagnostics and only threw once the registry compiled it.
      const content = JSON.stringify({
        version: 1,
        rules: [],
        actions: [
          {
            id: 'a1',
            appliesTo: { kind: 'nameMatches', pattern: '(' },
            spec: { kind: 'openFolder', window: 'current' },
          },
        ],
      });
      let result: ReturnType<typeof loadRulesFile> | undefined;
      expect(() => {
        result = loadRulesFile(content, []);
      }).not.toThrow();
      expect(result?.file).toBeUndefined();
      expect(result?.diagnostics).toContainEqual(
        expect.objectContaining({ path: '/actions/0/appliesTo/pattern' }),
      );
    });

    it('rejects a catastrophic-backtracking appliesTo pattern with a diagnostic', () => {
      // Without this, an action's appliesTo would bypass the complexity screening that exists
      // specifically because a synchronous regexp cannot be interrupted in Node (fact 26) —
      // meaning it would run, unscreened, against every visible node on every refresh.
      const content = JSON.stringify({
        version: 1,
        rules: [],
        actions: [
          {
            id: 'a1',
            appliesTo: { kind: 'nameMatches', pattern: '(a+)+' },
            spec: { kind: 'openFolder', window: 'current' },
          },
        ],
      });
      const result = loadRulesFile(content, []);
      expect(result.file).toBeUndefined();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ path: '/actions/0/appliesTo/pattern' }),
      );
    });

    it('accepts a well-formed appliesTo condition', () => {
      const content = JSON.stringify({
        version: 1,
        rules: [],
        actions: [
          {
            id: 'a1',
            appliesTo: { kind: 'nameMatches', pattern: '^src$' },
            spec: { kind: 'openFolder', window: 'current' },
          },
        ],
      });
      const result = loadRulesFile(content, []);
      expect(result.diagnostics).toEqual([]);
    });

    it('round-trips declared actions through toRawRulesFile', () => {
      const actions = [{ id: 'a1', spec: { kind: 'openFolder', window: 'current' } as const }];
      const raw = toRawRulesFile(DEFAULT_RULES, actions);
      expect(raw.actions).toEqual(actions);
      const result = loadRulesFile(JSON.stringify(raw), []);
      expect(result.diagnostics).toEqual([]);
      expect(result.file?.actions).toEqual(actions);
    });
  });
});

describe('checkExternalModification', () => {
  it('allows a write when the on-disk mtime still matches what was last read', () => {
    expect(checkExternalModification(1000, 1000)).toBeUndefined();
  });

  it('rejects a write when the file changed on disk since it was last read', () => {
    // The single-writer contract (00-overview.md, "Хранение правил"): without this guard the
    // editor, the "Hide" quick action and the wizard could each overwrite the others' changes.
    const diagnostic = checkExternalModification(1000, 2000);
    expect(diagnostic).toBeDefined();
  });
});
