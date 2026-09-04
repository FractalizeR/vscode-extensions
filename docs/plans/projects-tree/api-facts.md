# Факты о VS Code API, на которые опирается план

Ревизия 4. Правило ужесточено после round 02, где эта таблица — введённая против ошибок такого
класса — сама содержала четыре: один ложный факт, один ложный наполовину, один с фиктивным
источником и один вывод, поданный как цитата. Round 03 нашёл в ревизии 3 ещё десять расхождений
(шесть материальных: факты 3, 6, 8, 13, 17, 18 — все закрыты правками на местах) и двенадцать
незаписанных утверждений об API, на которые опираются решения плана (закрыты фактами 24-35 ниже).
Факты 2, 5, 7, 8, 9 в этой ревизии переписаны: дословные цитаты с точными номерами строк вместо
пересказа/усечённых цитат/чужой атрибуции.

Область таблицы расширена этой ревизией: правило 1 покрывает не только VS Code API, но и поведение
рантайма (Node.js), на которое план опирается тем же образом — это факты 25 и 26.

**Правило:**
1. ни одно решение плана не опирается на утверждение об API, отсутствующее в этой таблице;
2. **строка обязана нести дословную цитату источника.** Ссылка на файл без цитаты недействительна:
   имя файла проверяемо глазами, цитата — нет. Именно так прошли четыре ошибки round 02;
3. столбец «тип» различает `цитата` (источник утверждает это прямо) и `вывод` (следствие из
   приведённых посылок). Вывод в роли цитаты — дефект.

4. **цитата берётся только из локально скачанного файла источника, командой, которую можно
   повторить** (`curl` + `grep`/`sed`), и в строке указывается эта команда или номер строки.
   Формулировка из пересказа страницы инструментом — не цитата. Это правило появилось после
   round 03, где проверка дала железную закономерность: все 13 строк, собранные `grep` по
   скачанному файлу, подтвердились дословно; все 10 строк, взятые из пересказа веб-страницы,
   разошлись с источником, причём две содержали текст, которого в источнике нет.

**Адресация в источниках, живущих на подвижной ветке.** Строки, ссылающиеся на файлы реализации
VS Code, указывают путь и номер строки на `main` — а `main` двигается, поэтому через месяц номер
адресует другой код, и правило 4 («команда, которую можно повторить») перестаёт выполняться, хотя
цитата остаётся верной (находка claude-14, round 06). Поэтому: **номер строки — вспомогательный
ориентир, воспроизводимость обеспечивает приведённая рядом команда `curl` + `grep` по содержимому,
а не по номеру.** Снимок `main`, против которого сверялись строки 39-61: `8cc6591ff9f0ed058cc3964ef5b45c31c422a2bb`
(2026-09-04). Проверка строки, чей номер уехал, начинается с `grep` по цитируемому тексту.

**Две базы сверки, и их нельзя смешивать:**

- **целевая планка — `1.85.0`** (нижняя граница `engines.vscode`). Решение плана годится только
  если API доступен здесь;
- **`main` на 2026-09-03** — откуда взяты номера строк и формулировки докстрингов. В 1.85 номера
  строк другие.

Каждая строка ниже, чей API мог появиться позже, несёт отметку о доступности на планке. Проверено
скачиванием `vscode.d.ts` тега `1.85.0`: `sendText(text, shouldExecute?)` — есть (строка 7336),
`TreeItemLabel.highlights` — есть (11679), `namespace l10n` — есть, out-of-workspace watching —
есть, `Terminal.shellIntegration` — **отсутствует**.

## Дерево и метки

**1. Метку узла можно выделить диапазонами.** Тип: цитата.
`vscode.d.ts:12436-12448`:
> `export interface TreeItemLabel { label: string; /** Ranges in the label to highlight. A range is defined as a tuple of two number where the first is the inclusive start index and the second the exclusive end index */ highlights?: [number, number][]; }`

**2. Настоящий bold метки существует, но за proposed API.** Тип: цитата.
`treeView.ts:1356` (объявление таблицы `syntaxes`) и `:1358` (отображение `**` → `bold`):
> `const syntaxes = [`
> `{ open: '**', close: '**', mark: () => { bold = true; } },`

`iconlabel.css:81-84`:
> `.monaco-icon-label.bold .monaco-icon-label-container .label-name { font-weight: bold; }`

Стабильный `TreeItemLabel.label` при этом типизирован только как `string` (`vscode.d.ts:12441`,
внутри интерфейса `TreeItemLabel`) — значения `MarkdownString` он не принимает, поэтому ветка
`processLabel`, распознающая `**`, для стабильного API недостижима. `MarkdownString` для
`TreeItemLabel.label` вводит только proposed-файл
`src/vscode-dts/vscode.proposed.treeItemMarkdownLabel.d.ts:16-19`:
> «Bold, italics, and strikethrough formatting, but only when the syntax wraps the entire string
> (e.g., `**bold**`, `_italic_`, `~~strikethrough~~`)»

Следствие для плана: не используется — proposed API недоступен без флага `--enable-proposed-api`.

**3. `highlights` рендерится через тот же канал, что подсветка встроенного поиска по дереву.**
Тип: вывод. Посылка — `treeView.ts:1403`: `treeItemLabel.highlights` маппится в `matches`, то же
поле, которым рендерится совпадение фильтра.
Следствие — **обратное тому, что стояло здесь в ревизии 3**: страдает не наше выделение, а поиск.
Диапазоны из `highlights` занимают канал, поэтому при фильтрации дерева пользователь не увидит
подсветку совпадения там, где мы уже выделили метку. Цена ложится на встроенный поиск, и это
довод не отказываться от `highlights`, а не полагаться на него как на единственный носитель.
Ошибочное следствие успело утечь в три места (комментарий `HighlightSpec` в 02-A, 03-B, шаг 3
walkthrough в 05-B) — все три исправлены вместе с этой строкой.

**4. `ExtHostTreeView` адресует элементы по идентичности объекта.** Тип: цитата.
`extHostTreeViews.ts:329`:
> `private _nodes: Map<T, TreeNode> = new Map<T, TreeNode>();`

и `_getHandlesToRefresh`: `const elementNodes = elements.map(element => this._nodes.get(element));`
Следствие: `refresh` на пересозданном объекте — молчаливый no-op.

**5. Id view — рекомендация уникальности, а не проверяемое платформой ограничение.** Тип: цитата.
`viewsExtensionPoint.ts:134` (и та же строка продублирована в `:184` для второй схемы вклада):
> «Identifier of the view. This should be unique across all views. It is recommended to include your
> extension id as part of the view id. Use this to register a data provider through
> `vscode.window.registerTreeDataProviderForView` API. Also to trigger activating your extension by
> registering `onView:${id}` event to `activationEvents`.»

Формулировка нормативная («should be», «recommended»), а не описание проверки платформы.

**Ревизия round 06: вывод, стоявший здесь, был неверен.** Прежняя редакция заключала «два view
расширения используют разные id по соглашению, а не потому что платформа запретит совпадение».
Платформа как раз запрещает — `viewsExtensionPoint.ts:473-480`
(`curl -s https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts | sed -n '470,482p'`):
> ```ts
> if (viewIds.has(item.id)) {
>     collector.error(localize('duplicateView1', "Cannot register multiple views with same id `{0}`", item.id));
>     continue;
> }
> if (this.viewsRegistry.getView(item.id) !== null) {
>     collector.error(localize('duplicateView2', "A view with id `{0}` is already registered.", item.id));
>     continue;
> }
```

Проверка двойная: `Set` виденных id внутри одного вклада и глобальный реестр против уже
зарегистрированного view. Коллизия даёт ошибку вклада, а не молчаливое затирание.

Решение плана от этой поправки не меняется — два view с разными id остаются двумя view, — но
основание другое: id обязаны различаться, потому что совпадение отвергается, а не только потому что
так рекомендовано. `activationEvents` c `onView:<id>` — часть той же цитаты (см. также факт 56 про
то, что на планке 1.85 это объявление уже не обязательно).

**6. `config.` в `when` документирован для настроек, вычисляемых в boolean.** Тип: цитата.
`vscode-docs/api/references/when-clause-contexts.md:270` (`curl` + `grep -n 'config\.'`):
> «**Note**: You can use any user or workspace setting that evaluates to a boolean here with the prefix `"config."`.»

там же `:336`:
> «In a when clause, you can reference a configuration (setting) value by prefixing it with `config.`, for example `config.editor.tabCompletion` or `config.breadcrumbs.enabled`.»

Равенство как оператор документировано отдельно (`:47`):
> «You can check for equality of a context key's value against a specified value. Note that the right-hand side is a value and not interpreted as a context key»

**Следствие, изменившее решение плана.** Сочетание «`config.` от **строковой** настройки + `==`»
прямой цитатой не подтверждается: документация про `config.` говорит о настройках, вычисляемых в
boolean. В ревизии 3 квалификатор «boolean» из цитаты выпал, и на этом висело переключение
размещения view (`projectsTree.location` — строка). Решение заменено: расширение само ставит
булевы context keys через `setContext`, и `when` смотрит на них. Это документировано дословно
(`when-clause-contexts.md:341-347`):
> «If you are authoring your own VS Code extension and need to enable/disable commands, menus, or views using a when clause context and none of the existing keys suit your needs, you can add your own context key with the `setContext` command.»

Заодно этот же механизм закрывает условие завершённости шага walkthrough (факт 21).

## Декорации файлов

**7. `badge` ограничен двумя «символами», нарушение бросает исключение.** Тип: цитата.
`extHostTypes.ts:2581-2599`:
> ```ts
> static validate(d: FileDecoration): boolean {
>     if (typeof d.badge === 'string') {
>         let len = nextCharLength(d.badge, 0);
>         if (len < d.badge.length) { len += nextCharLength(d.badge, len); }
>         if (d.badge.length > len) {
>             throw new Error(`The 'badge'-property must be undefined or a short character`);
>         }
>     } else if (d.badge) { if (!ThemeIcon.isThemeIcon(d.badge)) { throw new Error(`The 'badge'-property is not a valid ThemeIcon`); } }
>     if (!d.color && !d.badge && !d.tooltip) { throw new Error(`The decoration is empty`); }
> ```

Следствия, и оба существенны: бейдж длиннее двух символов роняет валидацию, а значит **декорация
отбрасывается целиком вместе с цветом**; декорация без `color`, `badge` и `tooltip` тоже
недопустима. В ревизии 2 этот факт был записан наоборот («ограничения нет») по чтению только
`extHostDecorations.ts`, где стоит проверка типа, а не длины.

**Что видит расширение при нарушении.** `extHostDecorations.ts:102-109`:
> ```ts
> try {
>     FileDecoration.validate(data);
>     if (data.badge && typeof data.badge !== 'string') {
>         checkProposedApiEnabled(extensionId, 'codiconDecoration');
>     }
>     result[id] = <DecorationData>[data.propagate, data.tooltip, data.badge, data.color];
> } catch (e) {
>     this._logService.warn(`INVALID decoration from extension '${extensionId.identifier.value}': ${e}`);
> }
> ```

`FileDecoration.validate` вызывается внутри `try` на стороне extension host, а исключение
перехватывается и уходит в `this._logService.warn(...)` — расширению оно не пробрасывается: у
`provideFileDecoration` нет способа узнать, что валидация не прошла. Наблюдаемый эффект для
пользователя — декорация просто не появляется (`result[id]` не выставляется), без ошибки в коде
расширения. Следствие для плана: полагаться на `try/catch` вокруг создания декорации бессмысленно —
длину бейджа обязана отсекать собственная валидация плана (пакет 02-B) до передачи в
`FileDecoration`, а не перехват исключения платформы.

**8. Декорации требуют `resourceUri` и провайдер регистрируется глобально.** Тип: цитата.
`vscode.d.ts:11832-11835`:
> «Register a file decoration provider.
> @param provider A {@link FileDecorationProvider}.
> @returns A {@link Disposable} that unregisters the provider.»
> `export function registerFileDecorationProvider(provider: FileDecorationProvider): Disposable;`

Сигнатура не принимает ни id view, ни selector — регистрация ничем не привязана к конкретному
дереву. `treeView.ts:1436-1437`:
> ```ts
> if (resource) {
>     const fileDecorations = this.configurationService.getValue<{ colors: boolean; badges: boolean }>('explorer.decorations');
> ```

Ветка со значением `fileDecorations` (передаётся в `resourceLabel.setResource`, где рендерятся
цвет/бейдж) выполняется только когда у узла есть `resource`, то есть выведен из `node.resourceUri`
(`:1399`: `const resource = node.resourceUri ? URI.revive(node.resourceUri) : null;`). Без
`resourceUri` эта ветка не исполняется вовсе.
Следствие: декорации нашего провайдера появляются и в Explorer (регистрация глобальная, дерева не
существует на уровне API), а бейдж делит место с git; для их отображения в ProjectsTree каждый узел
обязан нести `resourceUri`.
На планке 1.85.0: есть (`grep -n "registerFileDecorationProvider" dts185.ts` → строка 11065).

**9. `propagate` распространяет декорацию к предкам, но платформа сама детей не обходит.** Тип:
цитата. `vscode.d.ts:8269-8270`, `FileDecoration.propagate`:
> «A flag expressing that this decoration should be
> propagated to its parents.»

Требование сигналить об этом — не в `onDidChangeFileDecorations` (это просто `Event`-поле без
докстринга про пропагацию), а в doc-комментарии метода `provideFileDecoration`, `:8300-8304`:
> «Provide decorations for a given uri.
>
> *Note* that this function is only called when a file gets rendered in the UI.
> This means a decoration from a descendent that propagates upwards must be signaled
> to the editor via the {@link FileDecorationProvider.onDidChangeFileDecorations onDidChangeFileDecorations}-event.»

Следствие: `provideFileDecoration` не вызывается платформой для узлов, которые не рендерятся —
чтобы декорация ребёнка «поднялась» на видимого предка, провайдер обязан сам сигналить об этом
предке через `onDidChangeFileDecorations`. Пассивной пропагации нет.
На планке 1.85.0: есть (`grep -n "propagated to its parents" dts185.ts` → строка 7544).

## Открытие проектов и терминал

**10. `vscode.openFolder` в текущем окне убивает extension host.** Тип: цитата.
`vscode-docs/api/references/commands.md:459-462`:
> «Open a folder or workspace in the current window or new window depending on the newWindow argument. Note that opening in the same window will shutdown the current extension host process and start a new one on the given folder/workspace unless the newWindow parameter is set to true.»
> «`forceNewWindow`: Whether to open the folder/workspace in a new window or the same. Defaults to opening in the same window.»

**11. `sendText` умеет вставлять текст без исполнения.** Тип: цитата. `vscode.d.ts:7723-7731`:
> «Send text to the terminal. The text is written to the stdin of the underlying pty process (shell) of the terminal.»
> «@param shouldExecute Indicates that the text being sent should be executed rather than just inserted in the terminal. The character(s) added are `\n` or `\r\n`, depending on the platform. This defaults to `true`.»

Следствие, меняющее модель безопасности: для действий с подстановками дефолт — `shouldExecute:
false`. Команда вставляется, пользователь видит её и нажимает Enter сам. Инъекция через имя каталога
перестаёт быть исполнением без ведома пользователя.

**12. Шелл терминала можно задать явно.** Тип: цитата. `vscode.d.ts:11665`:
> `export function createTerminal(name?: string, shellPath?: string, shellArgs?: readonly string[] | string): Terminal;`

и `TerminalOptions.shellPath`: «A path to a custom shell executable to be used in the terminal».
Следствие: правило квотирования не угадывается по настройкам пользователя — шелл задаётся действием.
На планке 1.85.0: есть (`grep -n "export function createTerminal" dts185.ts` → строка 10895).

**13. `Terminal.shellIntegration` на целевой планке отсутствует вовсе.** Тип: цитата.
Проверено скачиванием `vscode.d.ts` тега `1.85.0`: `grep -c 'shellIntegration' dts185.ts` → `0`.
На `main` член существует и его докстринг предупреждает о ненадёжности:
> «Note that this object may remain undefined if shell integration never activates. For example Command Prompt does not support shell integration and a user's shell setup could conflict with the automatic shell integration activation.»

Следствие: на планке 1.85 shell integration недоступна, а на более новых редакторах ненадёжна —
в обоих случаях она не замена `sendText`, и план на неё не опирается.

## Наблюдение за файлами

**14. Watcher работает вне воркспейса, в том числе рекурсивно.** Тип: цитата. `vscode.d.ts:14052-14066`:
> «#### Out of workspace file watching
> To watch a folder for changes to *.js files outside the workspace (non recursively), pass in a `Uri` to such a folder:
> `vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(<path to folder outside workspace>), '*.js'));`
> And use a complex glob pattern to watch recursively: … `'**/*.js'`»

Следствие: этап 07 реализуем — корни ProjectsTree лежат вне воркспейса.

## Манифест, настройки, локализация

**15. Без `capabilities.untrustedWorkspaces` расширение отключается в Restricted Mode.** Тип: цитата.
`code.visualstudio.com/api/extension-guides/workspace-trust`:
> «an extension that does not contribute anything to their `package.json` will be treated as not supporting Workspace Trust. It will be disabled when a workspace is in Restricted Mode»

**16. Схема настройки объявляется только инлайн; `$ref` не поддерживается.** Тип: цитата.
`contribution-points.md`, `contributes.configuration`:
> «Not supported in the configuration section are: `$ref` and `definition`: The configuration schemas needs to be self-contained and cannot make assumptions how the aggregated settings JSON schema document looks like.»

Следствие: рекурсивный `Condition` в `settings.json` полной схемой не описывается.

**17. `jsonValidation` применяется к файлам по `fileMatch`.** Тип: цитата. `contribution-points.md`:
> «Contribute a validation schema for a specific type of `json` file. The `url` value can be either a local path to a schema file included in the extension or a remote server URL such as a json schema store.»

Следствие (тип: **вывод**): семантика `fileMatch` в документации не описана — приведён только
пример `.jshintrc`. Реализация принимает и глоб по пути, поэтому схему можно навести точнее, чем
на любое совпадение имени. Но путь к файлу правил лежит в `globalStorageUri`, то есть
машинозависим, а `fileMatch` статичен в манифесте — абсолютный путь там невыразим. Значит
совпадение по имени или глобу неизбежно, и остаточный риск навестись на одноимённый файл в чужом
проекте остаётся; он принимается, потому что схема ничего не исполняет.

**18. `scope: machine` — только user или remote settings; дефолт — `window`.** Тип: цитата.
`contribution-points.md:515-516` (`curl` + `grep -n 'machine'`):
> «`machine` - Machine specific settings that can be set only in user settings or only in remote settings. For example, an installation path which shouldn't be shared across machines. The value of these settings will not be synchronized.»
> «`machine-overridable` - Machine specific settings that can be overridden by workspace or folder settings.»

В ревизии 3 здесь стояла фраза «can be configured in user settings only» — она принадлежит
соседнему пункту `application`, то есть цитата была собрана из чужого пункта.
**Следствие, которого план не рассматривал:** `machine`-настройка приходит не только из user
settings, но и из **remote settings**. Для модели угроз это отдельная ветка (04-B): remote —
не воркспейс, но и не локальная машина пользователя.

**19. Рантайм-локализация требует поля `l10n` в манифесте.** Тип: цитата. `vscode.d.ts:18189-18195`:
> «you must have `l10n` defined in your extension manifest and have bundle.l10n.<language>.json files. For more information on how to generate bundle.l10n.<language>.json files, check out the [vscode-l10n repo](https://github.com/microsoft/vscode-l10n).»

В ревизии 2 источником этого факта была названа `common-capabilities`, где слова `l10n` нет вовсе.

**20. `menus` и заголовки команд объявляются статически.** Тип: **вывод**.
Посылки — `contribution-points.md:1005` (`contributes.menus` — объявление в манифесте) и `:248`
(«Contribute the UI for a command consisting of a title and (optionally) an icon, category, and enabled state»).
Следствие: пункт меню с заголовком из настроек невозможен; динамика доступна только через `when` по
context key. Прямого утверждения «нельзя наполнить меню из настроек» в документации нет — в
ревизии 2 этот вывод был подан как цитата.

**21. `completionEvents` шага walkthrough включает `onContext`.** Тип: цитата.
`contribution-points.md:1778-1786`:
> «Available completion events include: `onCommand:myCommand.id` … `onSettingChanged:mySetting.id`: Check off step once the given setting has been modified. `onContext:contextKeyExpression`: Check off step when a context key expression evaluates true. … `onView:myView.id` …»

Следствие: «корни выбраны» выразимо через собственный context key, а не через «шаг завершён по
запуску команды». `onSettingChanged` для этого не годится: он срабатывает на любое изменение
настройки, а не на «значение непустое».

## Публикация

**22. `publisher` и `name` — `^[a-z0-9][a-z0-9\-]*$/i`, точки запрещены.** Тип: цитата.
`microsoft/vscode-vsce/src/validation.ts`:
> ```ts
> const nameRegex = /^[a-z0-9][a-z0-9\-]*$/i;
> export function validatePublisher(publisher: string | undefined): string { … if (!nameRegex.test(publisher)) { throw new Error(`Invalid extension "publisher"…`); } }
> ```

**23. `secrets` недоступен в `if` — ни на уровне job, ни на уровне step.** Тип: цитата.
`docs.github.com`, таблица доступности контекстов:
> `jobs.<job_id>.if` → `github, needs, vars, inputs`
> `jobs.<job_id>.steps.if` → `github, needs, strategy, matrix, job, runner, env, vars, steps, inputs`

`secrets` отсутствует в обеих строках. В ревизии 2 факт был записан как «недоступен в `jobs.if`,
доступен в `steps.if`» — вторая половина ложна, и это была ошибка чтения: я взял итоговую
формулировку ответа, противоречившую приведённой в нём же таблице.
Следствие: секрет прокидывается в `env` (job или step), а `if` проверяет `env.X != ''`.

## Дополнительные факты обратного прохода (round 03)

Обратный проход по `00-overview.md` и `01`..`07` нашёл 12 утверждений об API/рантайме, на которых
решения плана держатся, но которых в таблице не было (round 03, находка claude-06). Ниже — все
12, каждое с решением плана, которое на нём висит.

**24. Settings Sync не переносит файлы `globalStorageUri`; синхронизируется только `globalState` и
только явно перечисленные ключи.** Тип: цитата. `vscode-docs/docs/configure/settings-sync.md:18-27`
(`curl` + `grep -n`), список синхронизируемых категорий:
> «Currently, the Settings Sync supports the following settings:
> * Settings
> * Keyboard shortcuts
> * User snippets
> * User tasks
> * UI State
> * Extensions
> * Profiles»

Файлы в `globalStorageUri` в списке отсутствуют. Отдельно, `:121`, про перенос состояния
расширения:
> «If your extension needs to preserve some user state across different machines then provide the
> state to Settings Sync using `vscode.ExtensionContext.globalState.setKeysForSync`.»

Следствие: единственный документированный канал переноса между машинами — `globalState` через
`setKeysForSync`, а не файл. Обосновывает решения 00-overview/02-B: файл кэша/правил в
`globalStorageUri` не синхронизируется, и это названная цена, а не недосмотр.

**25. `.bat`/`.cmd` на Windows не запускаются без шелла.** Тип: цитата (Node.js, не VS Code API —
решение 04-A на этом строится напрямую).
`nodejs/node@main doc/api/child_process.md:119-121`:
> «however, `.bat` and `.cmd` files are not executable on their own without a
> terminal, and therefore cannot be launched using [`child_process.execFile()`][].»

Следствие: массив аргументов `execFile`/`spawn` без `shell: true` не защищает `.cmd`/`.bat`-цели —
они не запускаются вовсе, а не «запускаются безопасно». Решение 04-A обязано трактовать такие цели
как `terminal`-действие (через `sendText`, факт 11), а не как обычный процесс.

**26. Синхронное регулярное выражение в Node нечем прервать по бюджету времени.** Тип: вывод.
Посылки: (а) `nodejs/node@main doc/api/worker_threads.md:1472` — «The `Worker` class represents an
independent JavaScript execution thread.» — без явного `Worker` весь JS-код расширения выполняется
на одном потоке; (б) `nodejs/node@main doc/api/vm.md:2185-2272` — единственный документированный
механизм прерывания синхронного выполнения по таймауту (`vm.Script` с опцией `timeout`) охватывает
только код, исполняемый через `vm.Context`, и даже там асинхронные колбэки
(`process.nextTick`, `setTimeout` и т.п.), запланированные изнутри, «are not controllable through
the timeout either». Обычный код расширения (в том числе `RegExp.prototype.test`/`exec`) через
`vm.Context` не выполняется и такого механизма не имеет вовсе.
Следствие: «бюджет времени прервёт дорогую регулярку» — ложная посылка; решение этапа 02 обязано
проверять сложность паттерна до исполнения (не бюджетом after the fact), что и зафиксировано в
секции опровергнутых.

**27. `TreeItem.id` определяет идентичность узла для selection/expansion state; при отсутствии
генерируется из `label` и «плывёт» вместе с ним.** Тип: цитата. `vscode.d.ts:12307-12309`:
> «Optional id for the tree item that has to be unique across tree. The id is used to preserve the
> selection and expansion state of the tree item.
>
> If not provided, an id is generated using the tree item's label. **Note** that when labels change,
> ids will change and that selection and expansion state cannot be kept stable anymore.»

Следствие: решение 03-A задаёт `TreeItem.id` явно через собственный `NodeKey` (не путь — путь
меняется при перемещении/переименовании), иначе смена отображаемого label узла ProjectsTree рвёт
раскрытие/выделение без видимой причины пользователю.
На планке 1.85.0: есть (`grep -n "has to be unique across tree" dts185.ts` → строка 11533).

**28. `explorer.decorations.colors`/`.badges` управляют тем же каналом рендеринга, что несёт наши
декорации, и подключаются только к узлам с `resourceUri`.** Тип: цитата. `treeView.ts:1436-1437`:
> ```ts
> if (resource) {
>     const fileDecorations = this.configurationService.getValue<{ colors: boolean; badges: boolean }>('explorer.decorations');
> ```

Следствие: если пользователь выключит `explorer.decorations.colors`/`.badges`, наши декорации (факт
8, тот же носитель) перестанут отображаться в ProjectsTree вместе со всеми остальными — DoD пакета
03-B и текст онбординга обязаны называть это ограничение явно, а не полагаться на «декорации всегда
видны».

**29. `contributes.keybindings` поддерживает аргументы команды через `args`.** Тип: цитата.
`vscode-docs/docs/configure/keybindings.md:197-209` (`curl` + `grep -n`):
> «## Command arguments
>
> You can invoke a command with arguments. This is useful if you often perform the same operation on
> a specific file or folder. You can add a custom keyboard shortcut to do exactly what you want.»
> «The `type` command will receive `{"text": "Hello World"}` as its first argument, and add "Hello
> World" to the file instead of producing the default command.»

Следствие: заявленная в 04-C функция (горячая клавиша с заранее заданным аргументом действия)
подтверждена документацией платформы, а не является собственным изобретением плана.

**30. Строки манифеста локализуются через `%key%` + `package.nls.json`.** Тип: цитата.
`vscode-docs/api/extension-guides/workspace-trust.md:38`:
> «The value for the `description` property should be added to `package.nls.json` and then
> referenced in the `package.json` file for localization support.»

Синтаксис `%key%` в самом манифесте виден в примере `contribution-points.md:535`:
> `"description": "%config.alwaysSignOff%"`

Следствие: пакет 03-D покрывает статические строки манифеста через `%key%`/`package.nls*.json`;
факт 19 (рантайм `l10n`) — отдельный канал для строк, генерируемых в коде, и друг друга не заменяют.

**31. `contributes.viewsWelcome` применяется только к пустому дереву и управляется через `when`.**
Тип: цитата. `contribution-points.md:1710`:
> «Contribute welcome content to Custom views. Welcome content only applies to empty tree views. A
> view is considered empty if the tree has no children and no `TreeView.message`. … Visibility of the
> welcome content can be controlled with the `when` context value.»

Следствие: решение 05-A (два состояния пустого view — «корни не выбраны» / «корни выбраны, но
дерево не построилось») реализуемо `viewsWelcome` с разными `when` по context key плюс
`setContext` (факт 6), без кастомного рендеринга внутри `TreeDataProvider`.

**32. `contributes.colors` объявляет темизируемые цвета, потребляемые через `ThemeColor` и
настраиваемые пользователем.** Тип: цитата. `contribution-points.md:217`:
> «Contributes new themable colors. These colors can be used by the extension in editor decorators
> and in the status bar. Once defined, users can customize the color in the
> `workspace.colorCustomization` setting and user themes can set the color value.»

Источник называет настройку `workspace.colorCustomization` — это либо устаревшее, либо неточное имя
в самой доке (действующая настройка в текущем UI VS Code — `workbench.colorCustomizations`); цитата
приведена как есть, расхождение не устранялось интерпретацией. Следствие для 03-B не меняется:
`contributes.colors` — точка вклада для темизируемого цвета декорации, независимая от
`FileDecoration.color` (факт 7/8).

**33. `webview.setState`/`getState` сохраняют состояние webview на время скрытия панели без
`retainContextWhenHidden`.** Тип: цитата. `vscode.d.ts:10184-10188`:
> «Persistence within a session allows a webview to save its state when it becomes hidden
> and restore its content from this state when it becomes visible again. It is powered entirely
> by the webview content itself. To save off a persisted state, call `acquireVsCodeApi().setState()`
> with any json serializable object. To restore the state again, call `getState()`»

Следствие: решение 06-A не обязано включать дорогой `retainContextWhenHidden` ради сохранения
несохранённых правок редактора правил при переключении фокуса — `setState`/`getState` работают в
рамках сессии и без него.
На планке 1.85.0: есть (`grep -n "Persistence within a session allows a webview" dts185.ts` →
строка 9449).

**34. `ExtensionContext.globalStorageUri` — отдельная от `globalState` файловая директория,
гарантированно существующая родителем, но не собой.** Тип: цитата. `vscode.d.ts:8521-8530`:
> «The uri of a directory in which the extension can store global state.
> The directory might not exist on disk and creation is
> up to the extension. However, the parent directory is guaranteed to be existent.
>
> Use {@linkcode ExtensionContext.globalState globalState} to store key value data.»

Следствие: решения 07-A/00-overview используют `globalStorageUri` как место кэша и файла правил
именно как файловое хранилище (создание каталога — обязанность расширения), а не как замену
`globalState`, и это тот же объект, что не синхронизируется Settings Sync (факт 24).
На планке 1.85.0: есть (`grep -n "readonly globalStorageUri" dts185.ts` → строка 7804).

**35. Все API, на которые опирается план, доступны не позднее 1.85; самый свежий из них —
`l10n`, финализированный в 1.73.** Тип: вывод. Посылка — `vscode-docs/release-notes/v1_73.md:283`:
> «This iteration, we've completed the final piece of the puzzle: strings in extension code. This was
> checked off due to the finalization of the localization API that we proposed last month.»

Плюс перекрёстная сверка тегом `1.85.0`, уже проведённая по каждому цитируемому члену API индивидуально
(`sendText`/`shouldExecute` — строка 7336, `TreeItemLabel.highlights` — 11679, `namespace l10n` —
16968, `registerFileDecorationProvider` — 11065, `globalStorageUri` — 7804, `TreeItem.id` — 11533,
webview-персистентность — 9449, `FileDecoration.propagate` — 7544, out-of-workspace watching —
13241; `Terminal.shellIntegration` — единственное исключение, отсутствует, факт 13). Следствие: это
само по себе утверждение об API, и именно оно обосновывает значение `engines.vscode = ^1.85.0` в
01-D — до этой строки данное значение держалось на непроверенном допущении.

**36. `workbench.action.openSettings` accepts a plain string argument as the settings search
query, kept for backward compatibility.** Тип: цитата.
`microsoft/vscode@main src/vs/workbench/contrib/preferences/browser/preferences.contribution.ts`
(`curl` + `grep -n`), the command's handler:
```ts
run(accessor: ServicesAccessor, args: string | IOpenSettingsActionOptions) {
    // args takes a string for backcompat
    const opts = typeof args === 'string' ? { query: args } : sanitizeOpenSettingsArgs(args);
```

Следствие: `command:workbench.action.openSettings?<arg>` с одним строковым аргументом (например,
`@ext:fractalizer.projects-tree`) открывает настройки, уже отфильтрованные этим запросом — не
нужен объектный аргумент `{ query: ... }`, хотя он тоже работает (факт подтверждает оба пути, но
план использует более короткий строковый).

**37. Ссылка `command:` в trusted Markdown декодирует query как JSON; не-массив оборачивается в
массив из одного аргумента перед вызовом команды.** Тип: цитата.
`microsoft/vscode@main src/vs/editor/browser/services/openerService.ts:47-59` (`curl` + `grep -n`):
```ts
let args: unknown[] = [];
try {
    args = parse(decodeURIComponent(target.query));
} catch {
    try {
        args = parse(target.query);
    } catch {
        // ignore error
    }
}
if (!Array.isArray(args)) {
    args = [args];
}
await this._commandService.executeCommand(target.path, ...args);
```

Следствие: ссылка вида `[Open Settings](command:workbench.action.openSettings?%22%40ext%3A...%22)`
— query это URI-кодированный JSON-литерал строки (включая кавычки) — декодируется в одну строку,
оборачивается в `[строка]` и передаётся `executeCommand('workbench.action.openSettings', строка)`,
что по факту 36 задаёт `query` диалога настроек. Используется в `viewsWelcome` (03-C, 03-05) для
ссылки на отфильтрованные настройки расширения без объектного аргумента.


**38. `workspace.onDidChangeConfiguration` fires whenever configuration changed, with no carve-out
for a change written by the extension's own `WorkspaceConfiguration.update()` call.** Тип: цитата.
`vscode.d.ts:13603-13607` (`grep -n "onDidChangeConfiguration" dts185.ts` → строка 13607):
> «An event that is emitted when the {@link WorkspaceConfiguration configuration} changed.»
> `export const onDidChangeConfiguration: Event<ConfigurationChangeEvent>;`

Следствие: слушатель, уже подписанный `onTreeConfigurationChanged` (`docs/plans/projects-tree/
00-overview.md`), реагирует и на программную запись `projectsTree.addRoot` (04-E) через
`update(..., ConfigurationTarget.Global)`, не только на правку файла настроек руками — отдельного
механизма «обновить дерево после своей же записи» не нужно.

## Пакет 03-B: декорации и метки

**39. `createTreeView(viewId, options)` существует, и `TreeViewOptions` несёт `treeDataProvider`,
`showCollapseAll`, `canSelectMany`, `dragAndDropController`, `manageCheckboxStateManually`.** Тип:
цитата. `vscode.d.ts:11697-11703`:
> «Create a {@link TreeView} for the view contributed using the extension point `views`.
> @param viewId Id of the view contributed using the extension point `views`.
> @param options Options for creating the {@link TreeView}
> @returns a {@link TreeView}.»
> `export function createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T>;`

`vscode.d.ts:11852` (`export interface TreeViewOptions<T> {`) с полями `treeDataProvider`
(`:11857`), `showCollapseAll?: boolean` (`:11862`), `canSelectMany?: boolean` (`:11869`),
`dragAndDropController?: TreeDragAndDropController<T>` (`:11874`),
`manageCheckboxStateManually?: boolean` (`:11912`). Номера проверяются
`grep -n "treeDataProvider: TreeDataProvider<T>;\|showCollapseAll?: boolean;" dts-main.ts`.

Ревизия round 06: в исходной редакции этой строки стояли `:1855-1857`, `:1862`, `:1868`, `:1873` —
у трёх номеров потеряна ведущая цифра, а два разошлись с источником на единицу, то есть ссылка была
невоспроизводима (находка qwen-09). Цитаты при этом верны — расходились только якоря.
На планке 1.85.0: есть (`grep -n "export function createTreeView" dts185.ts` → строка 10933;
поля `TreeViewOptions` — `grep -n "manageCheckboxStateManually\|dragAndDropController\|canSelectMany\|showCollapseAll" dts185.ts`, все найдены внутри интерфейса на строках 11092-11142).

**40. `TreeView` несёт `onDidExpandElement`/`onDidCollapseElement`, оба типа
`Event<TreeViewExpansionEvent<T>>`, где `TreeViewExpansionEvent<T>.element: T`.** Тип: цитата.
`vscode.d.ts:12146-12154`:
> «Event that is fired when an element is expanded»
> `readonly onDidExpandElement: Event<TreeViewExpansionEvent<T>>;`
> «Event that is fired when an element is collapsed»
> `readonly onDidCollapseElement: Event<TreeViewExpansionEvent<T>>;`

`vscode.d.ts:11918-11924`, `TreeViewExpansionEvent<T>`:
> «Element that is expanded or collapsed.»
> `readonly element: T;`

Следствие: пейлоад события — не diff и не индекс, а сам элемент дерева (тип `T` расширения);
подписка на оба события — единственный способ узнать о раскрытии/сворачивании узла пользователем.
На планке 1.85.0: есть (`grep -n "onDidExpandElement\|onDidCollapseElement" dts185.ts` → строки
11377, 11382; `TreeViewExpansionEvent` — строка 11148).

**41. `TreeItem.collapsibleState` — только *значение по умолчанию* при первом появлении узла;
если узел с тем же `id` (идентичность, факт 27) уже есть в дереве, побеждает его собственное
сохранённое состояние раскрытия, а не то, что вернул `getTreeItem`.** Тип: вывод. Прямого
докстринга у `collapsibleState` для этого нет (`vscode.d.ts:12352-12354`: «{@link
TreeItemCollapsibleState} of the tree item.» — не говорит о приоритете); посылки взяты из
реализации.

`microsoft/vscode@main src/vs/workbench/browser/parts/views/treeView.ts:752-754`, опция дерева
`collapseByDefault`:
> ```ts
> collapseByDefault: (e: ITreeItem): boolean => {
>     return e.collapsibleState !== TreeItemCollapsibleState.Expanded;
> },
> ```

`src/vs/base/browser/ui/tree/asyncDataTree.ts:611`, куда эта опция транслируется:
> `this.getDefaultCollapseState = e => options.collapseByDefault ? (options.collapseByDefault(e) ? ObjectTreeElementCollapseState.PreserveOrCollapsed : ObjectTreeElementCollapseState.PreserveOrExpanded) : undefined;`

`src/vs/base/browser/ui/tree/tree.ts:83-95`, `enum ObjectTreeElementCollapseState`:
> «`PreserveOrExpanded` — If the element is already in the tree, preserve its current state. Else,
> expand it.»
> «`PreserveOrCollapsed` — If the element is already in the tree, preserve its current state. Else,
> collapse it.»

Следствие: значение `collapsibleState`, которое узел получает от `getTreeItem` при каждом
`refresh`, не переопределяет уже раскрытый/свёрнутый узел (идентифицированный по `TreeItem.id`,
факт 27) — оно применяется только когда узел появляется в дереве впервые. Решению 03-B не нужно
(и бессмысленно) пересчитывать `collapsibleState` при каждом обновлении, чтобы «удержать» состояние
раскрытия — платформа уже это делает через `Preserve*`.

**42. `TreeItem.label` принимает `string | TreeItemLabel`; `TreeItem.description` существует,
типа `string | boolean`, и рендерится как менее заметный текст, при `true` выводится из
`resourceUri`.** Тип: цитата. `vscode.d.ts:12301-12325`:
> «A human-readable string describing this item. When `falsy`, it is derived from {@link
> TreeItem.resourceUri resourceUri}.»
> `label?: string | TreeItemLabel;`
> «A human-readable string which is rendered less prominent. When `true`, it is derived from
> {@link TreeItem.resourceUri resourceUri} and when `falsy`, it is not shown.»
> `description?: string | boolean;`

На планке 1.85.0: есть (`grep -n "label?: string | TreeItemLabel;\|description?: string | boolean;" dts185.ts` → строки 11530, 11559).

**43. `ThemeColor` конструируется из `id: string`; цвет, объявленный через `contributes.colors`,
потребляется именно этим конструктором.** Тип: цитата. `vscode.d.ts:918-929`:
> «A reference to one of the workbench colors as defined in
> https://code.visualstudio.com/api/references/theme-color. Using a theme color is preferred over
> a custom color as it gives theme authors and users the possibility to change the color.»
> `readonly id: string;`
> «Creates a reference to a theme color. @param id of the color. The available colors are listed in
> https://code.visualstudio.com/api/references/theme-color.»
> `constructor(id: string);`

`vscode-docs/api/references/contribution-points.md:215-243` (`contributes.colors`):
> «Contributes new themable colors. These colors can be used by the extension in editor decorators
> and in the status bar. Once defined, users can customize the color in the
> `workspace.colorCustomization` setting and user themes can set the color value.»
> «Extensions can consume new and existing theme colors with the `ThemeColor` API:»
> `const errorColor = new vscode.ThemeColor("superstatus.error");`

Следствие: `id`, зарегистрированный расширением через `contributes.colors`, — валидный аргумент
`new ThemeColor(id)`; отдельного «списка допустимых id» для сборки нет, doc-пример показывает свой
же вклад как id. Расхождение имени настройки (`workspace.colorCustomization` вместо действующего
`workbench.colorCustomizations`) уже зафиксировано фактом 32 и на эту строку не переносится.
**На планке 1.85.0: конструктор есть, свойство `id` — НЕТ.** Ревизия этой строки, добавившая её в
round 04, проверила доступность грепом по `constructor(id: string);` (строка 894 в `dts185.ts`) и
распространила вердикт «есть» на всю строку, включая цитату `readonly id: string;`. Это неверно.
`@types/vscode@1.85.0`, `index.d.ts:900-907` — весь класс целиком:
> ```ts
> export class ThemeColor {
>
> 	/**
> 	 * Creates a reference to a theme color.
> 	 * @param id of the color. The available colors are listed in https://code.visualstudio.com/api/references/theme-color.
> 	 */
> 	constructor(id: string);
> }
> ```

Публичного члена `id` здесь нет; `readonly id: string;` появляется позже (есть в 1.134.0, строка
928). Проверяется дословно:
`grep -n -A 14 "export class ThemeColor" node_modules/.pnpm/@types+vscode@1.85.0/node_modules/@types/vscode/index.d.ts`

Следствие для плана: `ThemeColor` на планке — **непрозрачный** объект. Его можно только
конструировать; прочитать из него id нельзя ни в production-коде, ни в тесте. Пакет 03-B поймал это
компилятором (`TS2339` в `decorationProvider.ts`), а не ревью, — то есть цена ошибки здесь оказалась
низкой только потому, что планка проверяется машинно на каждом `typecheck`.

**Урок для правила 4 этой таблицы:** вердикт о доступности обязан относиться к тому члену API, на
который опирается решение, а не к соседнему члену того же класса. Грепа по конструктору
недостаточно, если решение читает свойство.

**44. `ThemeIcon` конструктор — `(id: string, color?: ThemeColor)`; переданный цвет применяется
именно в `TreeItem`.** Тип: цитата. `vscode.d.ts:940-966`:
> «The optional ThemeColor of the icon. The color is currently only used in {@link TreeItem}.»
> `readonly color?: ThemeColor | undefined;`
> «Creates a reference to a theme icon. @param id id of the icon… @param color optional
> `ThemeColor` for the icon. The color is currently only used in {@link TreeItem}.»
> `constructor(id: string, color?: ThemeColor);`

Следствие: второй аргумент `ThemeIcon` — не общего назначения, докстринг сам называет `TreeItem`
единственным потребителем; для ProjectsTree это прямо то место, где план собирается его применять,
а не побочный эффект, обнаруженный опытным путём.
На планке 1.85.0: есть (`grep -n "constructor(id: string, color?: ThemeColor);" dts185.ts` →
строка 937).

**45. `FileDecoration` конструктор — `(badge?: string, tooltip?: string, color?: ThemeColor)` в
этом порядке; `propagate` в конструктор не входит и выставляется отдельным присваиванием
свойства.** Тип: цитата. `vscode.d.ts:8256-8281`:
> `badge?: string;`
> «A human-readable tooltip for this decoration.»
> `tooltip?: string;`
> «The color of this decoration.»
> `color?: ThemeColor;`
> «A flag expressing that this decoration should be propagated to its parents.»
> `propagate?: boolean;`
> «Creates a new decoration. @param badge A letter that represents the decoration. @param tooltip
> The tooltip of the decoration. @param color The color of the decoration.»
> `constructor(badge?: string, tooltip?: string, color?: ThemeColor);`

Следствие: `new FileDecoration(badge, tooltip, color)` не может сразу выставить `propagate` —
нужна отдельная строка `deco.propagate = true` после конструктора; порядок параметров конструктора
(`badge`, затем `tooltip`, затем `color`) значим для позиционного вызова.
На планке 1.85.0: есть (`grep -n "constructor(badge?: string, tooltip?: string, color?: ThemeColor);" dts185.ts` → строка 7555).

## Пакет 03-C: размещение view

**46. `contributes.views` принимает `explorer`, `scm`, `debug`, `test` как встроенные id
контейнеров, плюс кастомные из `viewsContainers`; `explorer` — точный id.** Тип: цитата.
`vscode-docs/api/references/contribution-points.md:1624-1628`:
> «Contribute a view to VS Code. You must specify an identifier and name for the view. You can
> contribute to following view containers:»
> «- `explorer`: Explorer view container in the Activity Bar»

Следствие: `"views": { "explorer": [...] }` — рабочий способ добавить ProjectsTree в Explorer без
собственного контейнера, если план выберет это размещение вместо `viewsContainers.activitybar`.

**47. Кастомный контейнер `viewsContainers.activitybar` регистрируется с `hideIfEmpty: true`
безусловно — платформа сама прячет его иконку в Activity Bar, когда ни один вложенный view не
проходит свой `when` (в частности когда единственный view скрыт).** Тип: вывод. Цепочка посылок —
все из `microsoft/vscode@main`:

`src/vs/workbench/api/browser/viewsExtensionPoint.ts:318-320` (обработка ключа `activitybar` из
манифеста `viewsContainers`):
> ```ts
> case 'activitybar':
>     activityBarOrder = this.registerCustomViewContainers(value, description, activityBarOrder, existingViewContainers, ViewContainerLocation.Sidebar);
>     break;
> ```

`viewsExtensionPoint.ts:403-417`, `registerCustomViewContainer` — та же функция, куда попадают все
контейнеры из `viewsContainers.activitybar`:
> ```ts
> viewContainer = this.viewContainersRegistry.registerViewContainer({
>     id, title: { value: title, original: title }, extensionId,
>     ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [id, { mergeViewWithContainerWhenSingleView: true }]),
>     hideIfEmpty: true,
>     order, icon,
> }, location);
> ```

`src/vs/workbench/services/views/common/viewContainerModel.ts:527` — `activeViewDescriptors`
отфильтрован тем же `when`, что использует `contributes.views[].when`:
> `state.active = this.contextKeyService.contextMatchesRules(viewDescriptor.when);`

`src/vs/workbench/services/views/browser/viewsService.ts:191` — контекст-ключ, управляющий
видимостью композита (иконки) контейнера:
> `contextKey.set(!(viewContainer.hideIfEmpty && this.viewDescriptorService.getViewContainerModel(viewContainer).activeViewDescriptors.length === 0));`

`viewContainerModel.ts:339` — пересчёт реактивен, а не только при добавлении/удалении view:
> `this._register(Event.filter(contextKeyService.onDidChangeContext, e => e.affectsSome(this.contextKeys))(() => this.onDidChangeContext()));`

Следствие, **опровергающее исходную посылку плана**: контейнер, вклад в который сделан через
`viewsContainers.activitybar`, не оставляет пустую иконку, когда единственный view скрыт `when` —
`hideIfEmpty: true` жёстко зашит для всех расширений в `registerCustomViewContainer`, а
`activeViewDescriptors` (на который завязан `hideIfEmpty`) пересчитывается при каждом изменении
контекста, влияющего на `when` view. Иконка контейнера гаснет вместе со скрытием его единственного
view, а не остаётся пустой рамкой. Явно проверяемого «эффекта на планке 1.85.0» здесь нет —
цитируемые файлы не являются частью `vscode.d.ts`, это поведение хоста, а не API-поверхность,
которую можно закрепить по тегу; уверенность в стабильности этого поведения между 1.85 и `main` не
выше, чем у остальных фактов на реализации хоста в этой таблице (2, 3, 6, 8, 9, 28).

**48. `ExtensionContext.globalState` — `Memento & { setKeysForSync }`; `Memento.update` асинхронен
(`Thenable<void>`), `get`/`keys` синхронны.** Тип: цитата. `vscode.d.ts:8585-8615`:
> «Returns the stored keys. @returns The stored keys.»
> `keys(): readonly string[];`
> «Return a value. @param key A string. @returns The stored value or `undefined`.»
> `get<T>(key: string): T | undefined;`
> «Store a value. The value must be JSON-stringifyable. …»
> `update(key: string, value: any): Thenable<void>;`

Следствие: запись состояния (например, списка выбранных корней в 03-A/04-E) обязана
`await`-иться или обрабатываться как промис — `update` не завершается синхронно.
На планке 1.85.0: есть (`grep -n "update(key: string, value: any): Thenable<void>;" dts185.ts` →
строка 7888, внутри `interface Memento`, объявленного строкой 7852).

## Пакет 03-D: локализация

**49. Сообщение, переданное первым аргументом в `l10n.t(message, …)`, само служит ключом поиска
в загруженном бандле — отдельного идентификатора не заводится.** Тип: цитата.
`src/vs/workbench/api/common/extHostLocalizationService.ts:34-48`, `getMessage`:
> ```ts
> getMessage(extensionId: string, details: IStringDetails): string {
>     const { message, args, comment } = details;
>     if (this.isDefaultLanguage) {
>         return format2(message, (args ?? {}));
>     }
>     let key = message;
>     if (comment && comment.length > 0) {
>         key += `/${Array.isArray(comment) ? comment.join('') : comment}`;
>     }
>     const str = this.bundleCache.get(extensionId)?.contents[key];
> ```

Следствие: базовый бандл, из которого план генерирует переводы (`00-overview.md`), — это словарь
«английская строка кода → перевод», а не «символьный id → перевод»; ключ в `bundle.l10n.<lang>.json`
обязан дословно совпадать со строкой, переданной в `l10n.t`, плюс опциональный суффикс
`/<comment>`.

**50. Базовый (английский) `bundle.l10n.json` в рантайме не требуется: при `env.language`,
равном языку по умолчанию, платформа не обращается к бандлу вовсе; при отсутствии перевода для
ключа `l10n.t` возвращает сам аргумент `message`.** Тип: цитата.
`extHostLocalizationService.ts:35-37` (та же функция `getMessage`, что и факт 49):
> ```ts
> if (this.isDefaultLanguage) {
>     return format2(message, (args ?? {}));
> }
> ```

`extHostLocalizationService.ts:44-48`:
> ```ts
> const str = this.bundleCache.get(extensionId)?.contents[key];
> if (!str) {
>     this.logService.warn(`Using default string since no string found in i18n bundle that has the key: ${key}`);
> }
> return format2(str ?? message, (args ?? {}));
> ```

Независимое подтверждение — докстринг `vscode.d.ts:18257-18260`, `l10n.bundle`:
> «The bundle of localized strings that have been loaded for the extension. It's undefined if no
> bundle has been loaded. The bundle is typically not loaded if there was no bundle found or when
> we are running with the default language.»

Следствие: пакету 03-D не нужно поставлять `bundle.l10n.json` (без суффикса языка) как отдельный
файл для рантайм-строк — при английской локали загрузки бандла не происходит вообще (`getMessage`
формирует строку из `message` напрямую), а при любой другой локали отсутствие ключа или файла
деградирует до английского текста с предупреждением в лог, не до ошибки.
На планке 1.85.0: есть (`grep -n "export const bundle" dts185.ts` → строка 17032).

**51. Манифестные переводы называются `package.nls.{locale}.json` (например `package.nls.ru.json`
для русской локали); английский вариант — `package.nls.json` без суффикса, платформа сама
выбирает файл по локали пользователя и делает fallback на английский при пропуске ключа.** Тип:
цитата. `microsoft/vscode-l10n@main README.md:32-75` (`curl` + `grep -n`):
> «This file, along with `package.nls.{locale}.json` files, are used for translating static
> contributions in your extension's `package.json`.»
> «Your `./package.nls.de.json`:»
> «VS Code will automatically load the correct `package.nls.{locale}.json` (or `package.nls.json`
> for English) file based on the locale of the user. If no translation is available for a given
> key, VS Code will fall back to the English translation.»

Следствие: для русской локали файл называется `package.nls.ru.json` — прямое применение
шаблона `{locale}` из цитаты (источник иллюстрирует шаблон примером `.de.json`, не `.ru.json`
буквально; подстановка `ru` — не отдельное утверждение источника, а инстанциация
задокументированного шаблона). Комбинируется с фактом 30 (`%key%`/`package.nls.json`) — 30 фиксирует
синтаксис ссылки и базовый файл, эта строка — правило именования файла перевода.

**52. `env.language` — документированный способ узнать активную локаль редактора; `l10n.bundle`/
`l10n.uri` — соответственно загруженный бандл и его путь, оба `undefined`, когда бандл не
загружен.** Тип: цитата. `vscode.d.ts:10771-10773`:
> «Represents the preferred user-language, like `de-CH`, `fr`, or `en-US`.»
> `export const language: string;`

`vscode.d.ts:18199-18201` (докстринг `l10n.t`, ссылающийся на `env.language`):
> «If a localized bundle is available for the language specified by {@link env.language} and the
> bundle has a localized value for this message, then that localized value will be returned…»

Следствие: `vscode.l10n` не выставляет собственного «текущий язык» — план обязан читать
`vscode.env.language`, если решению 03-D нужно ветвиться по локали в коде (а не полагаться на
подстановку `l10n.t`).
На планке 1.85.0: есть (`grep -n "export const language: string;" dts185.ts` не совпал по
пробелам — фактическое совпадение `grep -n "preferred user-language" dts185.ts` → строка 10035,
`export const language: string;` — строка 10037).

## Интеграционное тестирование

**53. `@vscode/test-cli` ищет конфиг `.vscode-test.(js|json|mjs)` рядом с текущей директорией,
экспортирует `defineConfig`, конфиг несёт обязательный `files` и опциональный
`extensionDevelopmentPath`, тесты запускаются под Mocha через CLI-бинарь `vscode-test`.** Тип:
цитата. `microsoft/vscode-test-cli@main README.md:11-16` (`curl` + `grep -n`):
> «After installing the package, the runner is available as the `vscode-test` CLI. Running it will
> look for a `.vscode-test.(js/json/mjs)` file relative to the current working directory.»

Тот же README, пример конфигурации:
> ```js
> import { defineConfig } from '@vscode/test-cli';
> export default defineConfig({ files: 'out/test/**/*.test.js' });
> ```
> «Tests included with this command line are run in Mocha.»

`src/cli/args.mts:10` (`curl` + `grep -n "vscode-test\."`), значение по умолчанию для аргумента
конфига:
> `export const configFileDefault = 'nearest .vscode-test.js';`

`src/config.cts:9-29` (`curl` + `grep -n "files:\|extensionDevelopmentPath"`):
> «A file or list of files in which to find tests. Non-absolute paths will…»
> `files: string | readonly string[];`
> `extensionDevelopmentPath?: string | readonly string[];`

`src/runner.cts:8` (`curl` + `grep -n "Mocha"`):
> `const Mocha = (await import('mocha')).default;`

Следствие: скрипт `test:integration` (стадия 03) — это `vscode-test`, конфиг —
`.vscode-test.mjs` с `defineConfig`, набор тестов пишется под Mocha (`describe`/`it`), а не под
`vitest`, которым покрыт `src/projects/**`.

**54. `@vscode/test-electron` скачивает и запускает настоящую сборку VS Code
(`downloadAndUnzipVSCode`/`runTests`); `@vscode/test-cli` использует этот модуль как основу.**
Тип: цитата. `microsoft/vscode-test@main README.md:1-19` (`curl` + `grep -n`):
> «This module helps you test VS Code extensions. Note that new extensions may want to use the
> [VS Code Test CLI](https://github.com/microsoft/vscode-test-cli/blob/main/README.md), which
> leverages this module, for a richer editing and execution experience.»
> `import { runTests, runVSCodeCommand, downloadAndUnzipVSCode } from '@vscode/test-electron';`

Следствие: `@vscode/test-cli` — надстройка над `@vscode/test-electron`, а не независимая
реализация; настоящий редактор запускается транзитивно через тот же механизм
(`downloadAndUnzipVSCode` + `runTests`), а не эмулируется.

**55. `@vscode/test-cli`/`@vscode/test-electron` под Linux в CI требуют `xvfb`: официальный
пример пайплайна оборачивает запуск тестов в `xvfb-run` именно на Linux, и только там.** Тип:
цитата. `microsoft/vscode-test@main sample/.github/workflows/ci.yml:24-31` (`curl` + `cat`):
> ```yaml
> - name: Run tests
>   run: xvfb-run -a npm test
>   if: runner.os == 'Linux'
>
> - name: Run tests
>   run: npm test
>   if: runner.os != 'Linux'
> ```

Следствие: CI-джоб для `test:integration` (стадия 03) на Linux-раннере обязан оборачивать команду
в `xvfb-run -a`, иначе реальный запуск редактора (факт 54) не получит дисплей; macOS/Windows-раннеры
в обёртке не нуждаются — источник условия читает `runner.os`, что типично для GitHub Actions
(проект использует GitHub, не GitLab CI, где переменная называлась бы иначе, — сама подстановка
`runner.os` не проверялась отдельно и специфична для примера, взятого из GitHub Actions workflow).

**56. `onView:<id>` возникает, когда view с этим id РАСКРЫТ в сайдбаре; на планке 1.85 само
объявление уже не требуется.** Тип: цитата.
`vscode-docs/api/references/activation-events.md:146-156`
(`curl -s https://raw.githubusercontent.com/microsoft/vscode-docs/main/api/references/activation-events.md | sed -n '144,156p'`):
> «This activation event is emitted and interested extensions will be activated whenever a view of
> the specified id is expanded in the VS Code sidebar. Built-in views do not emit an activation
> event.»
> «The activation event below will fire whenever a view with the `nodeDependencies` id is visible:»
> «**Note**: Beginning with VS Code 1.74.0, views contributed by your extension do not require a
> corresponding `onView` activation event declaration for your extension to be activated.»

**Цитата приведена целиком намеренно** (находка claude-16): в первой редакции этой строки она
обрывалась перед двумя следующими абзацами, а они меняют картину дважды. Во-первых, источник
называет условие и «expanded», и «visible» — то есть точная граница события документацией не
задана, и выводить из неё что-то тоньше «view должен стать видимым» нельзя. Во-вторых, начиная с
1.74 объявление `onView` не требуется вовсе, а планка проекта — 1.85, то есть перечисленные в
манифесте `onView:<id>` на целевой планке избыточны.

Следствие для плана: избыточные объявления оставлены сознательно — они работают на любой версии и
читаются как документация к манифесту, — но замкнутый круг (факт 57) они не разрывают и разорвать
не могли: автоматически выведенное событие имеет ровно ту же предпосылку «view стал видимым».

**57. Собственный context key в `when` view + `onView` как единственное событие активации дают
замкнутый круг.** Тип: вывод. Посылки: факт 56 (событие возникает при раскрытии view); факт 47
(`activeViewDescriptors` фильтруется по `when`, и контейнер скрывается, когда ни один view не
проходит условие); факт 6 (значение собственного context key выставляет само расширение через
`setContext`).

Следствие: view, чей `when` ложен, раскрыть нельзя — значит `onView:<id>` не возникнет; ключ при
этом ставит только код расширения, который без активации не исполняется. Ни одно из решений 03-C не
разрывает круг само: ключи выставляются «при активации», а активироваться нечему.

Это **не** проверено живым прогоном. Попытка проверки описана честно: пробный тест под
`@vscode/test-cli` показал `isActive === false` до и после `executeCommand('projectsTree.view.focus')`,
но тот же результат получился и на манифесте **без** `when` — то есть проба измеряла поведение
тестового хоста, а не наличие круга, и доказательством ни в одну сторону не является.

Решение принято по стоимости ошибки, а не по вердикту: добавлен `onStartupFinished` (факт 58).
Если круга нет, лишнее событие активации стоит один обход корней на старте окна (18 мс на 181
реальном узле, измерено); если круг есть — без этого события дерево не появляется никогда, на
свежей установке. Условие пересмотра — живая проверка на чистом профиле.

**58. `onStartupFinished` — активация через некоторое время после старта, не замедляющая старт.**
Тип: цитата. `vscode-docs/api/references/activation-events.md:222` (та же команда, `grep -n -A 3
"^## onStartupFinished"`):
> «This activation event is emitted and interested extensions will be activated **some time after**
> VS Code starts up. This is similar to the `*` activation event, but it will not slow down VS Code
> startup. Currently, this event is emitted after all the `*` activated extensions have finished
> activating.»

Следствие: это документированная замена `*`, не ускоряющая ничего, но и не задерживающая окно.
Пара `onStartupFinished` + `onView:<id>` для каждого view сохраняет раннюю активацию, когда
пользователь сам открывает дерево, и гарантирует выставление context keys, когда не открывает.

**59. Путь IPC-сокета редактора ограничен 103 символами на macOS и 107 на Linux; при превышении
редактор печатает предупреждение, а сокет не открывается.** Тип: цитата.
`microsoft/vscode@main src/vs/base/parts/ipc/node/ipc.net.ts:739-742`
(`curl -s https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/base/parts/ipc/node/ipc.net.ts | sed -n '735,748p'`):
> ```ts
> const safeIpcPathLengths: { [platform: number]: number } = {
> 	[Platform.Linux]: 107,
> 	[Platform.Mac]: 103
> };
> ```

Там же `:807-811`:
> ```ts
> function validateIPCHandleLength(handle: string): void {
> 	const limit = safeIpcPathLengths[platform];
> 	if (typeof limit === 'number' && handle.length >= limit) {
> 		// https://nodejs.org/api/net.html#net_identifying_paths_for_ipc_connections
> 		console.warn(`WARNING: IPC handle "${handle}" is longer than ${limit} chars, try a shorter --user-data-dir`);
> 	}
> }
> ```

Наблюдение, из-за которого строка появилась (round 06, находка claude-07 — решение опиралось на это
ограничение, не имея под ним строки): при запуске `test:integration` из этого репозитория с
дефолтным `--user-data-dir` (`packages/projects-tree/.vscode-test/user-data/`) редактор напечатал
ровно это предупреждение и затем упал на старте:
> `WARNING: IPC handle "…/packages/projects-tree/.vscode-test/user-data/1.13-main.sock" is longer than 103 chars, try a shorter --user-data-dir`
> `Error: listen EINVAL: invalid argument …/user-data/1.13-main.sock`

Следствие: предупреждение сообщает о превышении, а падает `listen` — то есть ограничение жёсткое, а
не косметическое, и путь `--user-data-dir` обязан быть коротким независимо от глубины checkout.

**60. Один `TreeDataProvider` на два `TreeView` документацией не запрещён и не разрешён.** Тип:
вывод. Посылка — сигнатура `createTreeView(viewId, options)` (факт 39): она принимает провайдер на
каждый view и никак не ограничивает передачу одного и того же экземпляра дважды; утверждения о
разделяемом провайдере в документации нет ни в одну сторону.

Следствие, названное как принятый риск, а не как факт: решение 03-C регистрирует один провайдер на
оба id, поэтому `onDidChangeTreeData` у них общий и обновление приходит в оба view — что здесь и
требуется. Подтверждено только прогоном: интеграционный сьют поднимает настоящий редактор, оба view
объявлены, расширение активируется и дерево строится. Условие пересмотра — расхождение поведения
двух view при одном провайдере на какой-либо версии редактора.

**61. View, скрытый своим `when`, не опрашивается платформой.** Тип: вывод. Посылки — факт 47
(`activeViewDescriptors` фильтруется по тому же `when`, что объявлен у view, и пересчитывается на
каждое изменение контекста) и факт 56 (событие активации привязано к тому, что view становится
видимым). Скрытый view не входит в активные дескрипторы, не рендерится и, следовательно, не
запрашивает детей.

Следствие для 03-C: регистрация провайдера на оба id безопасна — скрытый view не приводит ни к
обходу ФС, ни к вызову `getChildren`. Прямой цитаты «hidden view is never queried» в документации
нет, поэтому это вывод, а не цитата (находка claude-06: решение опиралось на это утверждение, не
имея под ним строки).

## Опровергнутые утверждения предыдущих ревизий

Секция ведётся намеренно: план однажды уже построил на каждом из них решение.

| Ложное утверждение | Ревизия | Чем опровергнуто |
|---|---|---|
| «Жирный шрифт недостижим, `label` — plain text» | 1 | Факты 1, 2 |
| «`propagate` красит содержимое папки» | 1 | Факт 9: распространение к предкам |
| «Бейдж ≤2 символа — практическая рекомендация, ограничения API нет» | 2 | Факт 7: ограничение есть и бросает исключение, унося декорацию целиком |
| «Внешний файл схемы даст валидацию правил в `settings.json`» | 1 | Факты 16, 17 |
| «`secrets` доступен в `steps.if`» | 2 | Факт 23 |
| «Источник факта про `l10n` — `common-capabilities`» | 2 | Слова `l10n` там нет; факт 19 |
| «Невозможность динамических меню — цитата из документации» | 2 | Факт 20: это вывод |
| «Бюджет времени прервёт дорогую регулярку» | 2 | Синхронный `RegExp` в Node прервать нечем; факт 26 |
| «`config.<key> == 'строка'` в `when` — документированная форма» | 3 | Факт 6: документация говорит о настройках, вычисляемых в boolean; решение заменено на `setContext` |
| «При фильтрации дерева наше выделение подавляется» | 3 | Факт 3: следствие инвертировано — подавляется подсветка поиска |
| «`machine` = только user settings» | 3 | Факт 18: ещё и remote settings; цитата была взята из пункта `application` |
| «`Terminal.shellIntegration` есть, но ненадёжен» | 3 | Факт 13: на планке 1.85 его нет вовсе |
| «`fileMatch` — шаблон имени, а не путь» | 3 | Факт 17: принимает и глоб по пути; ограничение в другом — путь машинозависим |
| «`ThemeColor.id` доступен на планке 1.85» | round 04 (факт 43) | Класс на 1.85 объявляет только конструктор; `readonly id` появляется позже. Вердикт о доступности был снят грепом по конструктору, а опиралось решение на свойство |
| «Платформа не отвергает коллизию view id — различие id это соглашение» | round 04 (факт 5) | `viewsExtensionPoint.ts:473-480`: две проверки и `collector.error` на дубликат, локально и против глобального реестра |
| «Кастомный контейнер `viewsContainers.activitybar` оставляет пустую иконку в Activity Bar, когда его единственный view скрыт `when`» | round 04 (claim к 03-C) | Факт 47: `hideIfEmpty: true` зашит безусловно для всех расширений в `registerCustomViewContainer`, и пересчёт реактивен — иконка гаснет вместе с view |
