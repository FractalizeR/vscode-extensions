// Границы архитектуры (docs/plans/projects-tree/00-overview.md, «Архитектурное решение»).
// Пути matchers написаны как подстроки (без "^"), чтобы одна и та же конфигурация проверяла
// и реальное дерево (packages/projects-tree/src/**), и фикстуры-нарушители
// (tools/architecture-fixtures/<rule>/src/**) — у них разный префикс, но общий "хвост" раскладки.
//
// CORE_SUBJECTS экспортируется именованно: tools/depcruise-negative.ts пересчитывает по нему
// полный набор направленных пар no-sibling-internals независимо от того, что сейчас лежит в
// forbidden ниже — так потеря одного из сгенерированных правил (не только схлопывание всех) даёт
// расхождение и красный результат негативной проверки, а не молчаливое обеднение списка.
export const CORE_SUBJECTS = ['classification', 'discovery', 'actions'];

// 'vscode' устанавливается пакетом только как @types/vscode (без рантайм-кода), поэтому
// dependency-cruiser резолвит и обычный, и type-only импорт в путь до этого пакета типов внутри
// node_modules; там, где @types/vscode не резолвится (например, при прогоне только по каталогу
// tools/**), тот же импорт остаётся нерезолвленным именем "vscode". Матчер ловит оба случая, а не
// только один — что бы куда ни было установлено.
const VSCODE_IMPORT_PATH = '(^|/)@types/vscode/|^vscode$';

// "src/" here относится к дереву расширения (packages/projects-tree/src/**), а не к webview
// (packages/projects-tree/webview/src/**) — вторая половина каждого матчера ниже явно исключает
// сегмент "webview/" перед "src/", иначе webview не смог бы импортировать собственные соседние файлы.
const EXTENSION_SRC_PATH = '(^|/)(?<!/webview/)src/';

function siblingInternalsRules() {
  const pairs = CORE_SUBJECTS.flatMap((from) =>
    CORE_SUBJECTS.filter((to) => to !== from).map((to) => ({ from, to })),
  );
  return pairs.map(({ from, to }) => ({
    name: `no-sibling-internals:${from}->${to}`,
    comment:
      'Подпредметы projects/* ходят друг к другу только через index-файлы: прямой импорт ' +
      'внутренностей соседа скрывает границу подпредмета.',
    severity: 'error',
    from: { path: `(^|/)src/projects/${from}/` },
    to: {
      path: `(^|/)src/projects/${to}/`,
      pathNot: String.raw`(^|/)src/projects/${to}/index\.tsx?$`,
    },
  }));
}

export default {
  forbidden: [
    {
      name: 'no-vscode-in-core',
      comment:
        "Ядро (src/projects/**) не импортирует 'vscode' — ни обычным, ни type-only импортом: оно " +
        'обязано тестироваться без запуска редактора.',
      severity: 'error',
      from: { path: '(^|/)src/projects/' },
      to: { path: VSCODE_IMPORT_PATH },
    },
    {
      name: 'core-must-not-know-editor',
      comment:
        'Ядро не знает про адаптер редактора (src/editor/**) — зависимость только в одну сторону.',
      severity: 'error',
      from: { path: '(^|/)src/projects/' },
      to: { path: '(^|/)src/editor/' },
    },
    ...siblingInternalsRules(),
    {
      name: 'no-node-builtins-in-core-logic',
      comment:
        'Ядру запрещён доступ к ФС и процессу напрямую (node:fs, node:child_process и т.п.) — ' +
        'единственное разрешённое место для этого — порт ФС (src/projects/discovery/fileSystem.ts), ' +
        'иначе граница "ядро тестируемо на фейковой ФС" протекает молча. Список builtins сужен до тех, ' +
        'к которым относится это обоснование: чисто вычислительные модули (node:path, node:url и т.п.) ' +
        'ядру не запрещены. Матчер — по имени builtin-модуля (dependency-cruiser резолвит "node:fs" в ' +
        '"fs" без префикса, отсюда обе формы в regex), а не по dependencyTypes целиком.',
      severity: 'error',
      from: {
        path: '(^|/)src/projects/',
        pathNot: String.raw`(^|/)src/projects/discovery/fileSystem\.ts$`,
      },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?(fs|fs/promises|child_process|process|os)$',
      },
    },
    {
      name: 'webview-is-isolated',
      comment:
        'webview не импортирует ни vscode, ни какой-либо код расширения (весь src/ пакета, включая ' +
        'src/extension.ts и любой будущий каталог под ним), кроме типов протокола — те по определению ' +
        'живут вне src/ обеих сторон.',
      severity: 'error',
      from: { path: '(^|/)webview/src/' },
      to: { path: `${VSCODE_IMPORT_PATH}|${EXTENSION_SRC_PATH}` },
    },
    {
      name: 'no-stray-src-subject',
      comment:
        'Единственные каталоги верхнего уровня под src/ (кроме webview/src/) — projects/ и editor/: ' +
        'файл прямо под src/ (например, extension.ts) разрешён, а третий подкаталог — нет. Он даёт путь ' +
        'отмывки vscode/node-builtins в обход остальных правил (нет своего "from"/"to" ни у одного из ' +
        'них) и открывает webview дорогу в код расширения в обход webview-is-isolated.',
      severity: 'error',
      from: {},
      to: { path: `${EXTENSION_SRC_PATH}(?!(projects|editor)/)[^/]+/` },
    },
    {
      name: 'no-circular',
      comment: 'Циклические зависимости усложняют границы модулей и порядок инициализации.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
  },
};
