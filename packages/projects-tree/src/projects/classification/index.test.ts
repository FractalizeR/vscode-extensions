import { describe, expect, it } from 'vitest';
import {
  checkExternalModification,
  checkRegexComplexity,
  compileCondition,
  createClassifier,
  CURRENT_RULES_FILE_VERSION,
  DEFAULT_RULES,
  DEFAULT_VERDICT,
  loadRulesFile,
  normalizeVerdict,
  toRawRulesFile,
  validateRules,
  type Classifier,
  type Condition,
  type ConditionPredicate,
  type Diagnostic,
  type DirEntry,
  type FieldVerdict,
  type HighlightSpec,
  type LoadedRulesFile,
  type NodeFacts,
  type PartialVerdict,
  type RawActionDefinition,
  type RawActionSpec,
  type RawPartialVerdict,
  type RawRule,
  type RawRulesFile,
  type RegexSafetyResult,
  type Rule,
  type RulesFileLoadResult,
  type Verdict,
  type VerdictFieldName,
} from './index';

/**
 * Nothing outside classification/ wires this module in yet (discovery and the extension entry
 * point are later packages), so this file is the only thing exercising the barrel —
 * `index.ts`, the file every other subject must go through per dependency-cruiser's
 * no-sibling-internals rule. It touches every exported name deliberately: a barrel that silently
 * re-exports the wrong symbol, or drops one, only shows up when something outside the module
 * actually uses it — which nothing does yet.
 */
describe('classification/index — public surface', () => {
  it('exposes a working createClassifier built from Rule/Condition/PartialVerdict', () => {
    const entry: DirEntry = { name: '.git', type: 'dir' };
    const facts: NodeFacts = {
      rootId: 'root-1',
      absolutePath: '/work/project',
      pathFromRoot: 'project',
      name: 'project',
      depthFromRoot: 0,
      entries: [entry],
    };
    const highlight: HighlightSpec = { sortWeight: 1 };
    const verdictClaim: PartialVerdict = { project: true, tags: ['x'], highlight };
    const rules: Rule[] = [
      { id: 'r', when: { kind: 'hasChild', names: ['.git'] }, verdict: verdictClaim },
    ];

    const classifier: Classifier = createClassifier(rules);
    const verdict: Verdict = classifier.classify(facts);

    expect(verdict.project).toEqual({ value: true, byRule: 'r' });
    expect(verdict.tags).toEqual({ value: ['x'], byRule: 'r' });
    expect(verdict.highlight).toEqual({ value: highlight, byRule: 'r' });
  });

  it('exposes compileCondition as a standalone predicate factory, for reuse outside rules (e.g. actions.appliesTo)', () => {
    const condition: Condition = { kind: 'nameMatches', pattern: '^proj' };
    const predicate: ConditionPredicate = compileCondition(condition);
    expect(predicate({ name: 'project' } as NodeFacts)).toBe(true);
  });

  it('exposes DEFAULT_VERDICT and normalizeVerdict as the normalization building blocks', () => {
    const claimed: FieldVerdict<boolean> = { value: true, byRule: 'r' };
    const verdict: Verdict = {
      ...DEFAULT_VERDICT,
      skip: claimed,
      tags: { value: ['leaked'], byRule: 'r' },
    };
    expect(normalizeVerdict(verdict).tags).toEqual(DEFAULT_VERDICT.tags);
  });

  it('exposes every Verdict field name as a valid PartialVerdict key', () => {
    const fields: VerdictFieldName[] = [
      'skip',
      'stopDescend',
      'project',
      'primaryAction',
      'highlight',
      'tags',
    ];
    expect(fields).toHaveLength(6);
  });

  it('exposes DEFAULT_RULES, checkRegexComplexity and validateRules — the file-format DoD (02-B) checked without a rules file', () => {
    const safety: RegexSafetyResult = checkRegexComplexity('^src$');
    expect(safety.safe).toBe(true);
    const diagnostics: readonly Diagnostic[] = validateRules(DEFAULT_RULES, []);
    expect(diagnostics).toEqual([]);
  });

  it('exposes loadRulesFile/toRawRulesFile/checkExternalModification — the rules file load path', () => {
    const actionSpec: RawActionSpec = { kind: 'openFolder', window: 'current' };
    const actions: RawActionDefinition[] = [{ id: 'a1', spec: actionSpec }];
    const raw: RawRulesFile = toRawRulesFile(DEFAULT_RULES, actions, CURRENT_RULES_FILE_VERSION);
    const [rawRule]: readonly RawRule[] = raw.rules;
    const rawVerdict: RawPartialVerdict | undefined = rawRule?.then;
    expect(rawVerdict?.project).toBe(true);

    const result: RulesFileLoadResult = loadRulesFile(JSON.stringify(raw), []);
    const loaded: LoadedRulesFile | undefined = result.file;
    expect(loaded?.version).toBe(CURRENT_RULES_FILE_VERSION);
    expect(loaded?.rules).toHaveLength(DEFAULT_RULES.length);
    expect(loaded?.actions).toEqual(actions);

    expect(checkExternalModification(1, 1)).toBeUndefined();
  });
});
