// Public surface of the classification subject. Sibling subjects (discovery/, actions/) must go
// through this file rather than importing classification/*'s internals directly — machine-checked
// by dependency-cruiser's no-sibling-internals rule.

export type { Condition, ConditionPredicate, DirEntry, NodeFacts } from './condition';
export { compileCondition } from './condition';
export type { HighlightSpec } from './highlight';
export type { Rule } from './rule';
export type { Classifier } from './classifier';
export { createClassifier } from './classifier';
export type { FieldVerdict, PartialVerdict, Verdict, VerdictFieldName } from './verdict';
export { DEFAULT_VERDICT, normalizeVerdict } from './verdict';
export { DEFAULT_RULES } from './defaults';
export { checkRegexComplexity, type RegexSafetyResult } from './regex-safety';
export { validateRules, type Diagnostic } from './validation';
export {
  checkExternalModification,
  loadRulesFile,
  toRawRulesFile,
  CURRENT_RULES_FILE_VERSION,
  type LoadedRulesFile,
  type RawActionDefinition,
  type RawActionSpec,
  type RawPartialVerdict,
  type RawRule,
  type RawRulesFile,
  type RulesFileLoadResult,
} from './rules-file';
