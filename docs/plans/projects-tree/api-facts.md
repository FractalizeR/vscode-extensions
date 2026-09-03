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

Формулировка нормативная («should be», «recommended»), а не описание проверки платформы: строка не
утверждает, что коллизия id отвергается. Следствие для плана: два view расширения используют разные
id по соглашению, а не потому что платформа запретит совпадение; `activationEvents` обязан
перечислять `onView:<id>` для каждого — это часть той же цитаты, а не отдельное утверждение.

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
