Рабочее дерево менялось во время read-only ревью. Ниже — дефекты, подтверждённые на последнем проверенном состоянии. Исправленные по ходу прохода проблемы с `terminal.cwd`, `terminalName`, `rootPath` и устаревшими фактами для Hide в список не включены.

### R07-ACTION-CONDITION
- severity: HIGH
- kind: security
- title: `actions[].appliesTo` минует проверку регулярных выражений
- mechanism: загрузчик семантически валидирует условия только в `rules[].when`. Условия действий сразу компилируются реестром. Невалидный regexp выбрасывает исключение при активации/refresh, а regexp с катастрофическим backtracking минует существующий complexity screen и синхронно выполняется для каждого узла.
- trigger: файл с действием, содержащим `appliesTo: {"kind":"nameMatches","pattern":"("}` или, например, `pattern: "(a+)+"`.
- anchor: `packages/projects-tree/src/projects/classification/rules-file.ts:148-153`; `packages/projects-tree/src/editor/commands/actions/registry.ts:51-54`; `packages/projects-tree/src/projects/classification/validation.ts:66-82`
- evidence:
```ts
const domainDiagnostics = [
  ...validateActionIds(declaredActions),
  ...validateRules(rules, [...knownActionIds, ...declaredActions.map((action) => action.id)]),
];
```
```ts
(action) => ({ action, matches: compileAppliesTo(action) }),
```
- verification: verified — прослежена цепочка `loadRulesFile → createActionRegistry → compileCondition`; `validateCondition` вызывается только из `validateRules` для `rule.when`.
- fix_direction: применять рекурсивную семантическую проверку условий ко всем `actions/N/appliesTo` до возврата загруженного файла.

### R07-REMOTE-AUTHORITY
- severity: HIGH
- kind: security
- title: remote-доверие привязано к типу транспорта, а не к конкретному authority
- mechanism: ключ строится из `env.remoteName`. Для разных SSH-серверов это одно значение `ssh-remote`; после сохранения согласия проверка различает не серверы, а только класс remote extension.
- trigger: подтвердить исполнение в одном Remote SSH-контексте, затем открыть другой SSH authority в контексте, использующем тот же `globalState`.
- anchor: `packages/projects-tree/src/editor/configuration/trust.ts:60-62,111-128`; `docs/plans/projects-tree/api-facts.md:1287-1296`; `docs/plans/projects-tree/04-actions.md:165-170`
- evidence:
```ts
function remoteTrustKey(remoteName: string): string {
  return `projectsTree.remoteExecutionTrust.${remoteName}`;
}
```
```ts
if (this.#globalState.get<boolean>(remoteTrustKey(remoteName)) === true) {
  return { allowed: true };
}
```
- verification: verified — pinned API описывает значения `wsl` и `ssh-remote`, а не hostname/authority. Вывод факта 72, что значение годится как `per-authority` ключ, из приведённой цитаты не следует.
- fix_direction: сохранять согласие по идентичности конкретного authority. Если API 1.85 не даёт безопасно получить её, не запоминать согласие глобально между remote-сессиями.

### R07-REFRESH
- severity: HIGH
- kind: logic
- title: команда Refresh не перечитывает файл правил
- mechanism: опубликованный контракт обещает применить ручную правку на следующем refresh, но команда вызывает только `provider.refresh()`. Переменная `rules`, реестр действий и кэш обновляются лишь внутри `refreshFromSettings`.
- trigger: вручную изменить `projects-tree.rules.json` и выполнить Projects Tree: Refresh.
- anchor: `README.md:20`; `packages/projects-tree/src/editor/commands/refresh.ts:14-17`; `packages/projects-tree/src/extension.ts:104-115,146-169,253`
- evidence:
```ts
return vscode.commands.registerCommand(REFRESH_COMMAND, async () => {
  await target.refresh();
});
```
```ts
registerRefreshCommand(provider),
```
- verification: verified — watcher отсутствует; production-команда не достигает `loadCanonicalRules` и `createActionRegistry`.
- fix_direction: направить Refresh через единый reload-пайплайн: перечитать правила и actions, инвалидировать реестры/кэш, затем обновить provider.

### R07-CACHE-RACE
- severity: HIGH
- kind: logic
- title: завершившийся старый обход отменяет инвалидацию быстрого выбора
- mechanism: `invalidate()` очищает только готовое значение, оставляя `#building`. Старый обход после инвалидации записывает устаревший результат обратно; новый запрос до его завершения также присоединяется к старому promise.
- trigger: открыть Open Project на большом дереве и до завершения обхода изменить roots, rules или `maxDepth`, в том числе через Hide/Manage Hidden.
- anchor: `packages/projects-tree/src/editor/commands/open-project.ts:39-59`
- evidence:
```ts
invalidate(): void {
  this.#cached = undefined;
}
this.#building ??= build();
const result = await this.#building;
if (result !== undefined) this.#cached = result;
```
- verification: verified — generation/version и отмена старого build отсутствуют; существующий тест проверяет только последовательную инвалидацию уже готового результата.
- fix_direction: увеличивать generation при invalidation и запрещать старому поколению публиковать результат; следующий `get` должен начинать новый build, при возможности отменяя старый.

### R07-RULES-LOST-UPDATE
- severity: HIGH
- kind: logic
- title: проверка `mtime` не предотвращает потерю параллельной записи
- mechanism: `stat` и `rename` разделены несколькими await-точками. Два писателя могут проверить один исходный `mtime`, оба пройти проверку и по очереди заменить файл; последняя запись молча уничтожит результат первой. Ручное сохранение между `stat` и `rename` теряется аналогично.
- trigger: параллельные Hide/Manage Hidden из двух окон либо ручное сохранение файла во время записи команды.
- anchor: `packages/projects-tree/src/editor/rules/store.ts:143-171`
- evidence:
```ts
const stats = await stat(path);
currentMtimeMs = stats.mtimeMs;
```
```ts
await writeFile(tempPath, serialized, 'utf8');
try {
  await rename(tempPath, path);
```
- verification: verified — общей очереди, lock или CAS вокруг полного read-modify-write нет. Добавленный во время ревью комментарий описывает ограничение, но не устраняет потерю данных.
- fix_direction: выполнять read-modify-write под межоконной блокировкой с повторным чтением версии/содержимого после захвата; при невозможности получить блокировку отказываться от записи.

### R07-MAXDEPTH-TYPE
- severity: MEDIUM
- kind: contract
- title: Settings UI принимает дробный `maxDepth`, который runtime заменяет на 4
- mechanism: contribution объявляет произвольный `number`, а reader принимает только safe integer. Допустимое по манифесту значение вроде `1.5` неожиданно расширяет обход до дефолтной глубины 4.
- trigger: установить `projectsTree.maxDepth: 1.5`.
- anchor: `packages/projects-tree/package.json:312-317`; `packages/projects-tree/src/editor/configuration/settings.ts:152-161`
- evidence:
```json
"projectsTree.maxDepth": {
  "type": "number",
  "default": 4,
  "minimum": 0
}
```
```ts
return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : DEFAULT_MAX_DEPTH;
```
- verification: verified — манифест и runtime принимают разные множества значений.
- fix_direction: объявить настройку как целочисленную и синхронизировать ограничения манифеста, reader и тестов.

### R07-REMOVE-ROOT
- severity: MEDIUM
- kind: logic
- title: Remove Root недоступен при обычном отображении единственного корня
- mechanism: контекстное меню существует только у `rootGroup`, но режим `auto` с одним корнем и режим `never` таких узлов не создают. Вызов команды без аргумента из Command Palette лишь показывает ошибку.
- trigger: конфигурация по умолчанию с одним root либо любое число roots при `showRootNodes: "never"`.
- anchor: `packages/projects-tree/package.json:208-210,233-235`; `packages/projects-tree/src/editor/commands/roots.ts:75-80`
- evidence:
```json
"when": "view == projectsTree.view && viewItem == rootGroup"
```
```ts
if (!isRootGroupArg(explicitGroup)) {
  void vscode.window.showErrorMessage(vscode.l10n.t('No root is selected to remove.'));
  return;
}
```
- verification: verified — альтернативного пути выбора настроенного root обработчик не предоставляет.
- fix_direction: при вызове без `RootGroupArg` показывать QuickPick настроенных корней либо предоставить отдельную точку управления, не зависящую от синтетического узла.

### R07-L10N-BYPASS
- severity: MEDIUM
- kind: contract
- title: новые extension-owned строки обходят runtime-локализацию
- mechanism: названия встроенных действий и создаваемое Hide поле `title` записаны по-английски и показываются напрямую. `RenderError.message` также выводится без `vscode.l10n.t`. Эти строки невидимы для `l10n:check`, поэтому заявленный bilingual UI частично остаётся английским.
- trigger: русская локаль и открытие Actions/Manage Hidden либо ошибка рендера шаблона.
- anchor: `README.md:13`; `packages/projects-tree/src/projects/actions/builtin.ts:8-22`; `packages/projects-tree/src/editor/commands/show-actions.ts:43-46`; `packages/projects-tree/src/editor/commands/hidden.ts:43-50,197-200`; `packages/projects-tree/src/editor/commands/actions/runner.ts:55-60`
- evidence:
```ts
title: 'Open in New Window',
title: 'Open in Current Window',
title: 'Open',
```
```ts
title: `Hide: ${node.facts.pathFromRoot}`,
```
```ts
void vscode.window.showErrorMessage(error.message);
```
- verification: verified — строки отсутствуют в runtime bundles и напрямую достигают QuickPick/error UI; placeholders между английскими и русскими bundle-файлами совпадают.
- fix_direction: локализовать adapter-owned built-ins и ошибки в точке отображения; пользовательские `title` сохранять дословно. Для Hide хранить locale-neutral данные, чтобы смена языка не оставляла ранее записанный английский текст.

## Coverage

Просмотрены все 81 пути исходного scope: production-код, тесты, manifest/schema, обе пары l10n-файлов, оба README, план 04 целиком с изменёнными решениями, модель угроз, API-факты 10–13, 18, 20, 25, 29, 34, 48 и 62–85, а также отчёты round 05/06. Проверены все production-входы действий, gate, render targets, запись правил, `propagate`, кэш, `NodeSelection`, optional `getMaxDepth`, exports/reachability и тесты контрактов.

Обхода `ExecutionGate.check()` на последнем состоянии не найдено. Обычный round-trip сохраняет schema-known поля, порядок и отказывается писать файл с diagnostics; подтверждён отдельный конкурентный lost update. Повторная подмена defaults пользовательскими правилами не воспроизведена. Manifest/type-level тесты сравнивают независимые источники. Плейсхолдеры EN/RU совпадают.

Во время ревью извне менялись 14 scoped-файлов. Последние якоря выше перепроверены после изменений; полное повторное ревью всех промежуточных версий невозможно. Первоначально подтверждённые дефекты `terminal.cwd`, `terminalName`, неправильного `rootPath` и устаревших фактов Hide были исправлены до финальной проверки и поэтому не перечислены как действующие. Existing `review-07/raw` был сопоставлен только после независимого прохода. `pnpm check` и интеграционные тесты повторно не запускались согласно условию задания; `pnpm-lock.yaml` не рассматривался.
