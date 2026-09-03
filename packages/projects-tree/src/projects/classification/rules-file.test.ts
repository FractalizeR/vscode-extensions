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
