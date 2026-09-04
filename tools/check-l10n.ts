// Two channels ship bilingual UI (AGENTS.md, "Language"; api-facts.md facts 19/30/49-51), and each
// is a separate mechanism with its own failure mode if a key is missing: `package.nls*.json` for
// manifest strings (contributed declaratively, resolved by VS Code itself) and `l10n/bundle.l10n*.json`
// for `vscode.l10n.t()` call sites (resolved by the extension host at runtime, keyed by the message
// text itself — fact 49). A gap in either leaves the user staring at English.
//
// `generate` extracts the runtime-string key set from `packages/projects-tree/src/**/*.ts` (AST walk
// via the TypeScript compiler API — a regex over `l10n.t(...)` calls cannot safely handle a call
// spanning multiple lines, a message with an embedded quote, or the `comment` option changing the
// key, all of which occur in this repo's call sites) and writes `l10n/bundle.l10n.json` as an
// English reference (fact 50: the base bundle is not consulted at runtime under the default
// language, and a missing key there degrades to the message argument with a log warning — its only
// job here is to be the completeness check's source-of-truth artifact).
//
// `check` never writes. It re-extracts from source on every run — not by trusting the possibly-stale
// generated `bundle.l10n.json` — and compares the fresh key set against both `bundle.l10n.ru.json`
// and the generated base file itself. Deriving ground truth from source on every invocation, rather
// than from a file this same tool wrote earlier, is what keeps this from becoming the
// "check regenerates then compares against its own output" trap: a key deleted from source is caught
// even if nobody re-ran `generate` first, and a hand-edited `bundle.l10n.json` that drifted from
// source is caught too.
//
// Extraction failure is loud, not silent: a first argument to `l10n.t()` that is not a string
// literal or a `{ message, args?, comment? }` object literal with a string-literal `message` (e.g. a
// template literal with interpolation, or a variable) makes `generate`/`check` exit non-zero rather
// than skip the call — a silently dropped key is exactly the failure this tool exists to prevent.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = nodePath.join(HERE, '..');
const SRC_DIR = nodePath.join(REPO_ROOT, 'packages/projects-tree/src');
const PACKAGE_MANIFEST = nodePath.join(REPO_ROOT, 'packages/projects-tree/package.json');
const PACKAGE_NLS_EN = nodePath.join(REPO_ROOT, 'packages/projects-tree/package.nls.json');
const PACKAGE_NLS_RU = nodePath.join(REPO_ROOT, 'packages/projects-tree/package.nls.ru.json');
const BUNDLE_EN = nodePath.join(REPO_ROOT, 'packages/projects-tree/l10n/bundle.l10n.json');
const BUNDLE_RU = nodePath.join(REPO_ROOT, 'packages/projects-tree/l10n/bundle.l10n.ru.json');

interface ExtractedKey {
  readonly key: string;
  readonly file: string;
  readonly line: number;
}

interface ExtractionError {
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

export interface ExtractionResult {
  readonly keys: ExtractedKey[];
  readonly errors: ExtractionError[];
}

/**
 * Имена, под которыми в конкретном файле доступна `l10n`, собранные из его импортов, а не угаданные
 * по тексту. Прежняя версия сопоставляла идентификатор с литералом `'l10n'` и в комментарии
 * обещала, что переименование алиаса её не сломает; обещание было ложным —
 * `import { l10n as i18n } from 'vscode'; i18n.t('x')` не распознавался ни как вызов, ни как
 * ошибка извлечения, то есть строка исчезала молча (round 06, codex-07 / claude-12).
 */
/**
Стабильный порядок для диагностик. Отдельная функция, а не `.sort()` на месте: `toSorted()` требует
lib ES2023+, а репозиторий целится в ES2022, поэтому подавление правила нужно ровно в одном месте
(тот же приём в `tools/check-vsix-contents.ts`).
*/
function sortedCopy(values: readonly string[]): string[] {
  // eslint-disable-next-line unicorn/no-array-sort -- см. докстринг выше.
  return [...values].sort((a, b) => a.localeCompare(b));
}

interface L10nBindings {
  /**
  `import { l10n } from 'vscode'` или `import { l10n as i18n }` → `l10n` / `i18n`.
  */
  readonly direct: ReadonlySet<string>;
  /**
  `import * as vscode from 'vscode'` → `vscode`, обращение вида `vscode.l10n.t`.
  */
  readonly namespaces: ReadonlySet<string>;
}

function collectL10nBindings(sourceFile: ts.SourceFile): L10nBindings {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteralLike(specifier) || specifier.text !== 'vscode') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      // `propertyName` присутствует только у алиаса: `{ l10n as i18n }` даёт propertyName=l10n,
      // name=i18n. Без алиаса имя и есть импортируемый символ.
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === 'l10n') direct.add(element.name.text);
    }
  }
  return { direct, namespaces };
}

function isL10nNamespace(expression: ts.Expression, bindings: L10nBindings): boolean {
  if (ts.isIdentifier(expression)) return bindings.direct.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'l10n' &&
    ts.isIdentifier(expression.expression) &&
    bindings.namespaces.has(expression.expression.text)
  );
}

function isL10nTCall(node: ts.CallExpression, bindings: L10nBindings): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 't' &&
    isL10nNamespace(callee.expression, bindings)
  );
}

/**
Обращение к `l10n` где-либо, кроме позиции получателя в `<l10n>.t(...)`, — громкая ошибка, а не
пропуск. Именно так выглядят формы, из которых ключ извлечь нельзя: `const t = l10n.t; t('x')`,
передача `l10n` в функцию, `l10n['t']('x')`. Молчание здесь означало бы, что строка не попадёт ни в
бандл, ни в отчёт.
*/
function isUnextractableL10nUse(node: ts.Node, bindings: L10nBindings): boolean {
  if (!ts.isIdentifier(node) || !bindings.direct.has(node.text)) return false;
  const parent = node.parent as ts.Node | undefined;
  if (parent === undefined) return true;
  // Собственное объявление импорта — не использование.
  if (ts.isImportSpecifier(parent)) return false;
  if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) return true;
  if (parent.name.text !== 't') return true;
  const call = parent.parent as ts.Node | undefined;
  return !(call !== undefined && ts.isCallExpression(call) && call.expression === parent);
}

function stringLiteralArrayText(node: ts.Expression): string[] | undefined {
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  const values: string[] = [];
  for (const element of node.elements) {
    if (!ts.isStringLiteralLike(element)) return undefined;
    values.push(element.text);
  }
  return values;
}

// Mirrors `getMessage` in `extHostLocalizationService.ts` (api-facts.md, fact 49): the lookup key is
// the message text, plus `/<comment>` when a comment is given, comment array joined with ''.
function keyFromMessageAndComment(message: string, comment: string[] | undefined): string {
  if (comment === undefined || comment.length === 0) return message;
  return `${message}/${comment.join('')}`;
}

function extractFromObjectLiteralArgument(
  arg: ts.ObjectLiteralExpression,
): { key: string } | { error: string } {
  let messageText: string | undefined;
  let comment: string[] | undefined;
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === 'message') {
      if (!ts.isStringLiteralLike(prop.initializer)) {
        return { error: 'object-form l10n.t() call: "message" property is not a string literal' };
      }
      messageText = prop.initializer.text;
    } else if (prop.name.text === 'comment') {
      if (ts.isStringLiteralLike(prop.initializer)) {
        comment = [prop.initializer.text];
      } else {
        const arrayValues = stringLiteralArrayText(prop.initializer);
        if (arrayValues === undefined) {
          return {
            error:
              'object-form l10n.t() call: "comment" property is neither a string literal nor an ' +
              'array of string literals',
          };
        }
        comment = arrayValues;
      }
    }
  }
  if (messageText === undefined) {
    return { error: 'object-form l10n.t() call is missing a string-literal "message" property' };
  }
  return { key: keyFromMessageAndComment(messageText, comment) };
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function extractFromSourceFile(sourceFile: ts.SourceFile, relativePath: string): ExtractionResult {
  const keys: ExtractedKey[] = [];
  const errors: ExtractionError[] = [];

  const bindings = collectL10nBindings(sourceFile);

  const visit = (node: ts.Node): void => {
    if (isUnextractableL10nUse(node, bindings)) {
      errors.push({
        file: relativePath,
        line: lineOf(sourceFile, node),
        detail:
          'l10n is referenced somewhere other than as the receiver of a direct `.t(...)` call ' +
          '(for example aliased to a local, or passed as a value) — extraction cannot follow that, ' +
          'and the bundle key would be lost silently',
      });
    }
    if (ts.isCallExpression(node) && isL10nTCall(node, bindings)) {
      const [firstArg] = node.arguments;
      const line = lineOf(sourceFile, node);
      if (firstArg === undefined) {
        errors.push({ file: relativePath, line, detail: 'l10n.t() called with no arguments' });
      } else if (ts.isStringLiteralLike(firstArg)) {
        keys.push({ key: firstArg.text, file: relativePath, line });
      } else if (ts.isObjectLiteralExpression(firstArg)) {
        const result = extractFromObjectLiteralArgument(firstArg);
        if ('error' in result) {
          errors.push({ file: relativePath, line, detail: result.error });
        } else {
          keys.push({ key: result.key, file: relativePath, line });
        }
      } else {
        errors.push({
          file: relativePath,
          line,
          detail:
            'first argument to l10n.t() is neither a string literal nor a ' +
            '{ message, args?, comment? } object literal (e.g. a template literal with ' +
            'interpolation, or a variable) — extraction cannot determine the bundle key',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { keys, errors };
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = nodePath.join(dir, entry);
    // `throwIfNoEntry: false` tolerates a broken symlink left by discovery test fixtures
    // (`src/projects/discovery/__fixtures__/**`) — extraction only cares about `.ts` source, so an
    // unresolvable fixture path is skipped rather than crashing the tool.
    const stats = statSync(fullPath, { throwIfNoEntry: false });
    if (stats === undefined) continue;
    if (stats.isDirectory()) {
      out.push(...listSourceFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(fullPath);
    }
  }
  return out;
}

export function extractRuntimeKeys(srcDir: string): ExtractionResult {
  const keys: ExtractedKey[] = [];
  const errors: ExtractionError[] = [];
  for (const filePath of listSourceFiles(srcDir)) {
    const relativePath = nodePath.relative(REPO_ROOT, filePath);
    const text = readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
    const result = extractFromSourceFile(sourceFile, relativePath);
    keys.push(...result.keys);
    errors.push(...result.errors);
  }
  return { keys, errors };
}

function readJsonRecord(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} does not contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function sortedUniqueKeys(keys: readonly ExtractedKey[]): string[] {
  // Array#toSorted() requires lib ES2023+; tsconfig.base.json (shared across the repo) is pinned to
  // ES2022 (see the same constraint noted in tools/depcruise-negative.ts for Set#difference()), so
  // sorting here mutates a fresh spread array rather than the (already-fresh) array from Set, not
  // the caller's.
  // eslint-disable-next-line unicorn/no-array-sort -- see comment above
  return [...new Set(keys.map((entry) => entry.key))].sort((a, b) => a.localeCompare(b));
}

function buildBundle(keys: readonly string[]): Record<string, string> {
  const bundle: Record<string, string> = {};
  for (const key of keys) bundle[key] = key;
  return bundle;
}

function formatExtractionErrors(errors: readonly ExtractionError[]): string {
  return errors.map((error) => `  ${error.file}:${String(error.line)}: ${error.detail}`).join('\n');
}

function runGenerate(): void {
  const { keys, errors } = extractRuntimeKeys(SRC_DIR);
  if (errors.length > 0) {
    console.error('check-l10n generate: cannot extract runtime l10n keys — fix these call sites:');
    console.error(formatExtractionErrors(errors));
    process.exitCode = 1;
    return;
  }
  const bundle = buildBundle(sortedUniqueKeys(keys));
  writeFileSync(BUNDLE_EN, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  console.log(
    `check-l10n generate: wrote ${String(Object.keys(bundle).length)} key(s) to ` +
      `${nodePath.relative(REPO_ROOT, BUNDLE_EN)}.`,
  );
}

interface SetDiff {
  readonly missing: string[]; // in reference, not in target
  readonly extra: string[]; // in target, not in reference
}

function diffKeySets(reference: readonly string[], target: readonly string[]): SetDiff {
  const referenceSet = new Set(reference);
  const targetSet = new Set(target);
  // Array#toSorted() needs lib ES2023+, unavailable under this repo's shared ES2022
  // tsconfig.base.json; filter() already returns a fresh array, so sort() here does not mutate the
  // caller's.
  // eslint-disable-next-line unicorn/no-array-sort -- see comment above
  const missing = reference.filter((key) => !targetSet.has(key)).sort((a, b) => a.localeCompare(b));
  // eslint-disable-next-line unicorn/no-array-sort -- see comment above
  const extra = target.filter((key) => !referenceSet.has(key)).sort((a, b) => a.localeCompare(b));
  return { missing, extra };
}

function runCheck(): void {
  const problems: string[] = [];

  // Channel 1: manifest strings (package.nls.json -> package.nls.ru.json).
  const manifestEn = readJsonRecord(PACKAGE_NLS_EN);
  const manifestRu = readJsonRecord(PACKAGE_NLS_RU);
  const manifestDiff = diffKeySets(Object.keys(manifestEn), Object.keys(manifestRu));
  if (manifestDiff.missing.length > 0) {
    problems.push(
      `${nodePath.relative(REPO_ROOT, PACKAGE_NLS_RU)} is missing translation(s) for:\n` +
        manifestDiff.missing.map((key) => `  - ${key}`).join('\n'),
    );
  }
  if (manifestDiff.extra.length > 0) {
    problems.push(
      `${nodePath.relative(REPO_ROOT, PACKAGE_NLS_RU)} has key(s) not present in ` +
        `${nodePath.relative(REPO_ROOT, PACKAGE_NLS_EN)} (dead translation):\n` +
        manifestDiff.extra.map((key) => `  - ${key}`).join('\n'),
    );
  }

  // Channel 1b: every `%key%` the manifest references must exist in package.nls.json. VS Code does
  // not treat an unresolved reference as an error — it renders the literal `%key%` to the user, in
  // the settings UI or a view title — so a typo ships and looks like a rendering bug rather than a
  // missing string (round 06, codex-06 / qwen-04). Checked against the manifest as a whole rather
  // than field by field: `%key%` may appear in any contributed string, and enumerating the fields
  // that may carry one is exactly the list that goes stale.
  const manifestText = readFileSync(PACKAGE_MANIFEST, 'utf8');
  const referenced = new Set(
    Array.from(manifestText.matchAll(/"%([^"%]+)%"/g), (match) => match[1] ?? ''),
  );
  const dangling = sortedCopy([...referenced].filter((key) => !Object.hasOwn(manifestEn, key)));
  if (dangling.length > 0) {
    problems.push(
      `${nodePath.relative(REPO_ROOT, PACKAGE_MANIFEST)} references %key% placeholder(s) absent ` +
        `from ${nodePath.relative(REPO_ROOT, PACKAGE_NLS_EN)} (they render literally to the user):\n` +
        dangling.map((key) => `  - %${key}%`).join('\n'),
    );
  }
  const unreferenced = sortedCopy(Object.keys(manifestEn).filter((key) => !referenced.has(key)));
  if (unreferenced.length > 0) {
    problems.push(
      `${nodePath.relative(REPO_ROOT, PACKAGE_NLS_EN)} defines key(s) the manifest never ` +
        `references (dead string, and its translation is dead too):\n` +
        unreferenced.map((key) => `  - ${key}`).join('\n'),
    );
  }

  // Channel 2: runtime strings (l10n.t() call sites -> l10n/bundle.l10n.ru.json), re-extracted from
  // source on every run — see the file-level comment for why this must not read a previously
  // generated file as ground truth.
  const { keys: extractedKeys, errors } = extractRuntimeKeys(SRC_DIR);
  if (errors.length > 0) {
    problems.push(
      'cannot extract runtime l10n keys from source — fix these call sites:\n' +
        formatExtractionErrors(errors),
    );
  }
  const sourceKeys = sortedUniqueKeys(extractedKeys);

  const bundleRu = readJsonRecord(BUNDLE_RU);
  const runtimeDiff = diffKeySets(sourceKeys, Object.keys(bundleRu));
  if (runtimeDiff.missing.length > 0) {
    problems.push(
      `${nodePath.relative(REPO_ROOT, BUNDLE_RU)} is missing translation(s) for:\n` +
        runtimeDiff.missing.map((key) => `  - ${key}`).join('\n'),
    );
  }
  if (runtimeDiff.extra.length > 0) {
    problems.push(
      `${nodePath.relative(REPO_ROOT, BUNDLE_RU)} has key(s) no longer produced by any l10n.t() call ` +
        `in ${nodePath.relative(REPO_ROOT, SRC_DIR)} (dead translation):\n` +
        runtimeDiff.extra.map((key) => `  - ${key}`).join('\n'),
    );
  }

  // The generated base bundle (l10n/bundle.l10n.json) is a reference artifact, not a runtime
  // dependency (api-facts.md, fact 50) — but if it drifts from source, its only job (documenting the
  // English key set for humans and being an unambiguous diff target) is defeated. Compared in
  // memory against a freshly built expectation; never rewritten here.
  const bundleEn = readJsonRecord(BUNDLE_EN);
  const expectedBundleEn = buildBundle(sourceKeys);
  const bundleEnDiff = diffKeySets(Object.keys(expectedBundleEn), Object.keys(bundleEn));
  const bundleEnValueMismatches = sourceKeys.filter(
    (key) => Object.hasOwn(bundleEn, key) && bundleEn[key] !== key,
  );
  if (
    bundleEnDiff.missing.length > 0 ||
    bundleEnDiff.extra.length > 0 ||
    bundleEnValueMismatches.length > 0
  ) {
    const parts = [`${nodePath.relative(REPO_ROOT, BUNDLE_EN)} is stale — run the generate step:`];
    if (bundleEnDiff.missing.length > 0) {
      parts.push(`  missing key(s): ${bundleEnDiff.missing.join(', ')}`);
    }
    if (bundleEnDiff.extra.length > 0) {
      parts.push(`  stale key(s) no longer in source: ${bundleEnDiff.extra.join(', ')}`);
    }
    if (bundleEnValueMismatches.length > 0) {
      parts.push(`  value no longer matches its key: ${bundleEnValueMismatches.join(', ')}`);
    }
    problems.push(parts.join('\n'));
  }

  if (problems.length > 0) {
    console.error('check-l10n: translation is incomplete.\n');
    for (const problem of problems) {
      console.error(problem);
      console.error('');
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-l10n: OK — ${String(Object.keys(manifestEn).length)} manifest key(s) and ` +
      `${String(sourceKeys.length)} runtime key(s) fully translated to Russian.`,
  );
}

function main(): void {
  const mode = process.argv[2];
  if (mode === 'generate') {
    runGenerate();
  } else if (mode === 'check') {
    runCheck();
  } else {
    console.error('usage: node tools/check-l10n.ts <generate|check>');
    process.exitCode = 1;
  }
}

// Only run when executed directly (node tools/check-l10n.ts ...), not when imported by the test
// file. Compared as resolved paths, not as a hand-built `file://` string: that string form differs
// from what `import.meta.url` produces on Windows (drive letters, backslashes) and for any path
// needing percent-encoding, so the guard would silently never fire and the checks would be dead
// (round 06 review, qwen-05).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === nodePath.resolve(invokedPath)) {
  main();
}
