// Инверсия проверки границ: `pnpm depcruise` обязан быть зелёным на реальном коде, а этот скрипт —
// красным, если убрать реакцию на нарушение. Без него правило dependency-cruiser может тихо
// перестать срабатывать после рефактора конфига, а `depcruise` продолжит быть зелёным просто потому,
// что нарушать стало некому.
//
// Реализация: гоняем dependency-cruiser по фикстурам tools/architecture-fixtures/** и разбираем
// JSON-отчёт. Проверяются три независимых инварианта:
//
// 1. Каждое правило, ЖИВУЩЕЕ СЕЙЧАС в .dependency-cruiser.mjs (полное имя, не префикс до ":"),
//    обязано сработать хотя бы на одном файле-нарушителе (путь которого содержит "violator") и НИ
//    на одном контрольном образце (путь которого содержит "control"). Список правил читается из
//    самого конфига, а не хардкодится числом — новое правило автоматически требует своей пробы.
// 2. Набор направленных пар no-sibling-internals пересчитывается независимо от .dependency-cruiser.mjs
//    — из EXPECTED_CORE_SUBJECTS (см. ниже), той же комбинаторикой, что и siblingInternalsRules() в
//    конфиге. Инвариант (1) сам по себе не ловит удаление ПРАВИЛА из конфига (удалённого правила
//    просто не будет в списке, который он же и проверяет) — инвариант (2) ловит именно это.
// 3. CORE_SUBJECTS, импортированный из .dependency-cruiser.mjs, сверяется с независимым списком
//    EXPECTED_CORE_SUBJECTS, заданным прямо в этом файле. Без этого шага инвариант (2) сам себя не
//    защищает: и правила, и ожидания к ним считались бы из ОДНОГО и того же CORE_SUBJECTS, поэтому
//    удаление или добавление предмета (не пары, а целого подпредмета) синхронно меняло бы оба
//    множества и никогда не давало бы расхождения — та же болезнь, что была в исходной находке
//    claude-03/codex-03, только уровнем выше. Дублирование списка здесь — не техдолг, а смысл
//    проверки: два независимых источника, расхождение между ними — ошибка конфигурации.

import { spawnSync } from 'node:child_process';
import config, { CORE_SUBJECTS } from '../.dependency-cruiser.mjs';

const FIXTURES_DIR = 'tools/architecture-fixtures';

// Источник истины для состава подпредметов ядра — независимый от .dependency-cruiser.mjs (см.
// инвариант 3 в комментарии выше). Меняется только вместе с осознанным решением поменять раскладку
// ядра, а не как побочный эффект правки CORE_SUBJECTS в конфиге.
const EXPECTED_CORE_SUBJECTS = ['classification', 'discovery', 'actions'];

interface DependencyRuleHit {
  readonly name: string;
}

interface DependencyReportEntry {
  readonly valid: boolean;
  readonly rules?: readonly DependencyRuleHit[];
}

interface ModuleReportEntry {
  readonly source: string;
  readonly dependencies: readonly DependencyReportEntry[];
}

interface DependencyCruiserReport {
  readonly modules: readonly ModuleReportEntry[];
}

function isDependencyCruiserReport(value: unknown): value is DependencyCruiserReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { modules?: unknown }).modules)
  );
}

function runDependencyCruiser(): DependencyCruiserReport {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'depcruise',
      '--config',
      '.dependency-cruiser.mjs',
      '--output-type',
      'json',
      FIXTURES_DIR,
    ],
    { encoding: 'utf8' },
  );

  if (result.error) {
    throw result.error;
  }

  // dependency-cruiser завершается кодом 1, когда находит нарушения — это ожидаемый результат
  // прогона по намеренно нарушающим фикстурам, а не ошибка запуска.
  if (result.status !== 0 && result.status !== 1) {
    console.error(result.stderr);
    throw new Error(`dependency-cruiser завершился неожиданным кодом ${String(result.status)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error('Не удалось разобрать JSON-вывод dependency-cruiser', { cause: error });
  }

  if (!isDependencyCruiserReport(parsed)) {
    throw new Error('JSON-вывод dependency-cruiser не похож на отчёт (нет поля "modules")');
  }

  return parsed;
}

interface RuleHitsBySource {
  readonly firedByViolator: Map<string, Set<string>>; // rule name -> source paths с "violator"
  readonly controlViolations: { source: string; rule: string }[]; // control-файлы, поймавшие правило
}

function collectRuleHits(report: DependencyCruiserReport): RuleHitsBySource {
  const firedByViolator = new Map<string, Set<string>>();
  const controlViolations: { source: string; rule: string }[] = [];

  for (const dependencyModule of report.modules) {
    const isViolatorSource = dependencyModule.source.includes('violator');
    const isControlSource = dependencyModule.source.includes('control');
    const invalidDependencies = dependencyModule.dependencies.filter(
      (dependency) => !dependency.valid,
    );

    for (const dependency of invalidDependencies) {
      const firedRules = dependency.rules ?? [];
      for (const rule of firedRules) {
        if (isControlSource) {
          controlViolations.push({ source: dependencyModule.source, rule: rule.name });
        }
        if (isViolatorSource) {
          const sources = firedByViolator.get(rule.name) ?? new Set<string>();
          sources.add(dependencyModule.source);
          firedByViolator.set(rule.name, sources);
        }
      }
    }
  }

  return { firedByViolator, controlViolations };
}

function checkCoreSubjectsMatch(): string[] {
  const expected = new Set(EXPECTED_CORE_SUBJECTS);
  const actual = new Set<string>(CORE_SUBJECTS);

  // eslint-disable-next-line unicorn/prefer-set-methods -- см. пояснение к Set#difference() ниже
  const missing = [...expected].filter((name) => !actual.has(name));
  // eslint-disable-next-line unicorn/prefer-set-methods
  const extra = [...actual].filter((name) => !expected.has(name));

  if (missing.length === 0 && extra.length === 0) {
    return [];
  }

  const parts = [
    'CORE_SUBJECTS в .dependency-cruiser.mjs разошёлся с EXPECTED_CORE_SUBJECTS в tools/depcruise-negative.ts:',
  ];
  if (missing.length > 0) {
    parts.push(`  отсутствуют в CORE_SUBJECTS конфига: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    parts.push(`  есть в CORE_SUBJECTS конфига, но не ожидались: ${extra.join(', ')}`);
  }
  parts.push(
    '  Если состав подпредметов ядра действительно изменился — обнови EXPECTED_CORE_SUBJECTS ' +
      'в tools/depcruise-negative.ts как осознанную правку контракта раскладки, а не молча.',
  );
  return [parts.join('\n')];
}

function expectedSiblingPairNames(): string[] {
  return EXPECTED_CORE_SUBJECTS.flatMap((from: string) =>
    EXPECTED_CORE_SUBJECTS.filter((to: string) => to !== from).map(
      (to: string) => `no-sibling-internals:${from}->${to}`,
    ),
  );
}

function checkSiblingPairsMatchCombinatorics(actualRuleNames: readonly string[]): string[] {
  const expected = new Set(expectedSiblingPairNames());
  const actual = new Set(
    actualRuleNames.filter((name) => name.startsWith('no-sibling-internals:')),
  );

  const errors: string[] = [];
  // Set#difference() требует lib ES2024+; tsconfig.base.json (общий для всего репозитория) закреплён
  // на ES2022, поэтому разница множеств здесь — через filter, а не через нативный метод.
  // eslint-disable-next-line unicorn/prefer-set-methods
  const missing = [...expected].filter((name) => !actual.has(name));
  // eslint-disable-next-line unicorn/prefer-set-methods
  const extra = [...actual].filter((name) => !expected.has(name));

  if (missing.length > 0) {
    errors.push(
      'no-sibling-internals: в .dependency-cruiser.mjs отсутствуют направленные пары, ' +
        `обязанные существовать по полной комбинаторике EXPECTED_CORE_SUBJECTS: ${missing.join(', ')}`,
    );
  }
  if (extra.length > 0) {
    errors.push(
      'no-sibling-internals: в .dependency-cruiser.mjs есть пары, не входящие в комбинаторику ' +
        `EXPECTED_CORE_SUBJECTS (новый подпредмет добавлен в CORE_SUBJECTS конфига, но не в ` +
        `EXPECTED_CORE_SUBJECTS здесь): ${extra.join(', ')}`,
    );
  }
  return errors;
}

function main(): void {
  const actualRuleNames = config.forbidden.map((rule) => rule.name);

  const combinatoricsErrors = [
    ...checkCoreSubjectsMatch(),
    ...checkSiblingPairsMatchCombinatorics(actualRuleNames),
  ];

  const report = runDependencyCruiser();
  const { firedByViolator, controlViolations } = collectRuleHits(report);

  const missingViolatorHits = actualRuleNames.filter((name) => !firedByViolator.has(name));

  const errors: string[] = [...combinatoricsErrors];

  if (missingViolatorHits.length > 0) {
    errors.push(
      'Следующие правила НЕ сработали ни на одной фикстуре-нарушителе (путь с "violator"):\n' +
        missingViolatorHits.map((name) => `  - ${name}`).join('\n'),
    );
  }

  if (controlViolations.length > 0) {
    errors.push(
      'Следующие контрольные образцы (путь с "control") были ошибочно пойманы правилом — ' +
        'исключение либо контрольная фикстура разошлись с реальной границей:\n' +
        controlViolations.map(({ source, rule }) => `  - ${source} -> ${rule}`).join('\n'),
    );
  }

  if (errors.length > 0) {
    console.error('depcruise:negative: инварианты нарушены.\n');
    for (const error of errors) {
      console.error(error);
      console.error('');
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `depcruise:negative: все ${String(actualRuleNames.length)} правил(а) из .dependency-cruiser.mjs ` +
      'сработали на своих фикстурах-нарушителях и ни разу — на контрольных образцах; ' +
      'no-sibling-internals покрывает полную комбинаторику CORE_SUBJECTS.',
  );
}

main();
