import type { Condition } from './condition';
import type { HighlightSpec } from './highlight';
import { checkRegexComplexity } from './regex-safety';
import type { Rule } from './rule';

/**
 * One problem found in a rule set: `path` is a JSON-pointer-shaped address into the on-disk rules
 * file (`/rules/2/then/primaryAction`, `/rules/0/when/of/1/pattern`) — even though this module
 * validates the *internal* `Rule[]` (field `verdict`, not `then`), because the diagnostic is for a
 * human reading the file they wrote, not for the internal type. `rules-file.ts` reuses this shape for
 * its own (structural) diagnostics, keeping one diagnostic format across the whole load path.
 */
export interface Diagnostic {
  readonly path: string;
  readonly message: string;
}

/**
 * Validates a rule set beyond what the JSON Schema can express: it returns **every** diagnostic
 * found, not the first — a user editing a rules file with several mistakes needs to see all of them
 * at once, not fix-and-reload one at a time (docs/plans/projects-tree/02-core.md, package 02-B DoD).
 *
 * `knownActionIds` is a parameter, not an import: `primaryAction` references an
 * `ActionDefinition.id`, and that type is owned by the parallel `src/projects/actions/` package
 * (02-F). Importing it here would create a dependency this package cannot assume is ready, and
 * would violate the no-sibling-internals boundary between `classification/` and `actions/` even once
 * it is (docs/plans/projects-tree/00-overview.md, "Архитектурное решение"). The caller — whoever
 * assembles the object graph — resolves the id list and passes it in; this module never has to know
 * where actions live.
 */
export function validateRules(
  rules: readonly Rule[],
  knownActionIds: readonly string[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seenIds = new Set<string>();

  for (const [index, rule] of rules.entries()) {
    const base = `/rules/${String(index)}`;

    if (seenIds.has(rule.id)) {
      diagnostics.push({ path: `${base}/id`, message: `duplicate rule id "${rule.id}"` });
    }
    seenIds.add(rule.id);

    diagnostics.push(...validateCondition(rule.when, `${base}/when`));

    if (Object.hasOwn(rule.verdict, 'primaryAction')) {
      const { primaryAction } = rule.verdict;
      if (primaryAction !== undefined && !knownActionIds.includes(primaryAction)) {
        diagnostics.push({
          path: `${base}/then/primaryAction`,
          message: `references unknown action id "${primaryAction}"`,
        });
      }
    }

    if (Object.hasOwn(rule.verdict, 'highlight') && rule.verdict.highlight !== undefined) {
      diagnostics.push(...validateHighlight(rule.verdict.highlight, `${base}/then/highlight`));
    }
  }

  return diagnostics;
}

function validateCondition(condition: Condition, path: string): Diagnostic[] {
  switch (condition.kind) {
    case 'nameMatches': {
      // Compile first: an uncompilable pattern/flags pair (e.g. `pattern: "("`, `flags: "q"`) must
      // surface here as a diagnostic, not reach `compileCondition` later and throw a `SyntaxError`
      // that walks/classification never expects (see `compileCondition`'s doc comment — it
      // deliberately lets `new RegExp` throw, on the assumption this validation already ran).
      // Complexity screening only makes sense once the pattern is known to compile at all.
      try {
        // Compiled only to observe whether it throws — the result itself is discarded.
        new RegExp(condition.pattern, condition.flags);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ path: `${path}/pattern`, message: `invalid regular expression: ${message}` }];
      }
      const result = checkRegexComplexity(condition.pattern);
      return result.safe ? [] : [{ path: `${path}/pattern`, message: result.reason }];
    }
    case 'all':
    case 'any':
    case 'not': {
      return condition.of.flatMap((child, index) =>
        validateCondition(child, `${path}/of/${String(index)}`),
      );
    }
    // 'hasChild', 'depth', 'pathMatches' (a hand-rolled glob, not a user regex — see condition.ts),
    // 'pathEquals' and 'inRoot' carry no user-supplied regex and need no complexity screening.
    default: {
      return [];
    }
  }
}

/**
 * `badge` longer than two characters makes VS Code drop the whole `FileDecoration` it is part of,
 * `color` included (docs/plans/projects-tree/api-facts.md, fact 7) — catching it at rule-authoring
 * time is cheaper than losing a highlight silently at render time. Likewise a `HighlightSpec` with
 * every field left `undefined` is rejected here: VS Code rejects an empty decoration the same way
 * (fact 7), and `{ sortWeight }` alone is the one legitimate all-but-one-field-empty case, since
 * `sortWeight` never reaches the decoration.
 */
function validateHighlight(highlight: HighlightSpec, path: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Counted in Unicode code points, not UTF-16 code units (`.length`): VS Code's own check
  // (api-facts.md, fact 7 — `nextCharLength` applied twice) is code-point-aware, so a single
  // surrogate-pair emoji is one "character" to it, not two. Spreading a string iterates by code
  // point, matching that exactly — `.length` would reject `'🔥🔥'` (four UTF-16 units) even though
  // VS Code accepts it. `no-misused-spread` warns this can split a multi-code-point grapheme
  // cluster (a ZWJ emoji sequence, say) into pieces — irrelevant here, since code points (not
  // grapheme clusters) are exactly what fact 7's `nextCharLength` counts.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  if (highlight.badge !== undefined && [...highlight.badge].length > 2) {
    diagnostics.push({
      path: `${path}/badge`,
      message: 'must be at most 2 characters — VS Code drops the whole decoration otherwise',
    });
  }
  const hasDecoratingField =
    highlight.labelHighlight !== undefined ||
    highlight.color !== undefined ||
    highlight.badge !== undefined ||
    highlight.icon !== undefined ||
    highlight.description !== undefined;
  // sortWeight-only is legitimate — it affects ordering, never reaches the decoration layer.
  if (!hasDecoratingField && highlight.sortWeight === undefined) {
    diagnostics.push({
      path,
      message: 'must set at least one field — an empty decoration is rejected by VS Code',
    });
  }
  return diagnostics;
}
