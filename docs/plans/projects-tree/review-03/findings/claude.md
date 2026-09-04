# Находки ревьюера claude — целевая проверка `docs/plans/projects-tree/api-facts.md` (ревизия 3)

Материал: `docs/plans/projects-tree/api-facts.md`, 23 строки фактов + секция опровергнутых.
Проверка: каждая строка открыта в названном источнике (`microsoft/vscode@main`,
`microsoft/vscode-docs@main`, `microsoft/vscode-vsce@main`, `github/docs@main`), цитата сверена
с текстом источника, номер строки пересчитан, тип (`цитата`/`вывод`) проверен по наличию прямого
утверждения в источнике. Обратный проход — по `00-overview.md` и `01`..`07`.

Гипотеза задания («каждая из 23 строк несёт дословную, не искажённую цитату названного источника,
и таблица покрывает все утверждения об API, на которые опираются решения плана») — **опровергнута
по обеим половинам**: 10 строк из 23 расходятся с источником, из них 6 материально; обратный
проход дал 12 незаписанных утверждений об API, на которые опираются решения.

---

### claude-01

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: reliability
- **title**: Факт 3: следствие инвертировано — `highlights` подавляет подсветку фильтра, а не наоборот
- **mechanism**: Посылка процитирована верно (`treeView.ts:1403` действительно маппит `highlights` в `matches`), но следствие выведено в обратную сторону. В точке использования `matches` собственные highlights имеют приоритет над результатом фильтрации: fallback на `createMatches(element.filterData)` берётся только если наших `matches` нет. То есть при активной фильтрации подавляется не наше выделение, а подсветка совпадений фильтра.
- **trigger**: воспроизводится в нормальной работе — достаточно включить встроенный поиск по дереву на узле с `labelHighlight`
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:29-33`
- **evidence**:
  ```ts
  // microsoft/vscode@main src/vs/workbench/browser/parts/views/treeView.ts:1445 и :1459
  matches: matches ? matches : createMatches(element.filterData),
  ```
- **verification**: confirmed
- **verification_note**: обе точки установки `matches` (ветка с `resource` и ветка без) используют одно и то же выражение; `element.filterData` читается только при `matches === undefined`. Ложное следствие растиражировано в трёх местах плана: `00-overview.md` («при фильтрации наше выделение подавляется»), `03-tree-view.md` пакет 03-B, `02-core.md` комментарий в `HighlightSpec`, и попало в текст онбординга 05-B («подсветка уступает встроенному поиску по дереву»)
- **fix_direction**: переписать следствие факта 3 в фактическом направлении приоритета и пересмотреть зависящие от него формулировки в 00-overview, 03-B, 02-A и текст шага 3 walkthrough; отдельно решить, является ли потеря подсветки фильтра приемлемой ценой, — это другой вопрос, чем тот, на который план сейчас отвечает

---

### claude-02

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: reliability
- **title**: Факт 6: процитированная фраза про `config.<setting>` в источнике отсутствует и теряет квалификатор «boolean»
- **mechanism**: Строка подаёт «`config.<setting>` — any user or workspace setting» как цитату из `when-clause-contexts`. Такого текста в источнике нет: там сказано «You can use any user or workspace setting **that evaluates to a boolean** here with the prefix `"config."`». Отброшен ровно тот квалификатор, который относится к применению — план опирается на сравнение строкового enum (`config.projectsTree.location == 'explorer'`, пакет 03-C), а единственное явное утверждение источника это применение исключает. Второй релевантный абзац источника («Check a setting in a when clause») о сравнении значений и о нестроковых типах не говорит вообще.
- **trigger**: воспроизводится в нормальной работе — любая перепроверка строки в источнике фразу не находит
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:45-48`
- **evidence**:
  ```text
  # microsoft/vscode-docs@main api/references/when-clause-contexts.md:270
  >**Note**: You can use any user or workspace setting that evaluates to a boolean here with the prefix `"config."`.
  # :336 — In a when clause, you can reference a configuration (setting) value by prefixing it with `config.`,
  #        for example `config.editor.tabCompletion` or `config.breadcrumbs.enabled`.
  ```
- **verification**: confirmed
- **verification_note**: grep по `when-clause-contexts.md` даёт только строки 270 и 336; фразы из таблицы нет ни в одной. По существу приём рабочий — `ConfigAwareContextValuesContainer` в `src/vs/platform/contextkey/browser/contextKeyService.ts:163-168` кладёт значения типов `number|boolean|string` в контекст как есть, поэтому `==` со строкой сработает. То есть дефект — именно цитата и источник, а не решение 03-C
- **fix_direction**: заменить фабрикованную цитату на дословную из источника вместе с её квалификатором, а обоснование формы `config.<key> == 'значение'` перевести в тип `вывод` с посылкой из кода `contextKeyService`, поскольку документация этой формы не утверждает

---

### claude-03

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: security
- **title**: Факт 18: цитата про `scope: machine` в источнике отсутствует и сужает семантику
- **mechanism**: Строка приводит для `machine` цитату «can be configured in user settings only». В источнике у `machine` написано другое: «Machine specific settings that can be set only in user settings **or only in remote settings**». Приведённая формулировка принадлежит соседнему пункту `application` («can only be configured in user settings»), то есть цитата собрана из чужого пункта. Отброшенная половина («или только в remote settings») — часть модели угроз: в remote-сценарии значение приходит не из user settings.
- **trigger**: воспроизводится в нормальной работе — remote/SSH-окно, где machine-настройки берутся из remote settings
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:136-137`
- **evidence**:
  ```text
  # microsoft/vscode-docs@main api/references/contribution-points.md:515
  - `machine` - Machine specific settings that can be set only in user settings or only in remote settings. ...
  # :513 (application) - Settings that apply to all instances of VS Code and can only be configured in user settings.
  ```
- **verification**: confirmed
- **verification_note**: утверждение заголовка строки («не переопределяется из воркспейса», «дефолт — `window`») по существу верно — «If no `scope` is declared, the default is `window`» есть в источнике на :522, но не процитировано; дефект в самой цитате. На решение 04-B (`roots`/`maxDepth`/`defaultAction` со `scope: machine`) это не влияет, но remote-ветка модели угроз в плане не рассмотрена вовсе
- **fix_direction**: привести дословный текст пункта `machine`, добавить отдельную цитату про дефолт `window`, и проверить в 04-B, что ветка «значение из remote settings» модели угроз не противоречит

---

### claude-04

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: architecture
- **title**: Факт 17: следствие про `fileMatch` не следует из цитаты и противоречит реализации
- **mechanism**: Процитирован абзац про `url` (локальный путь или удалённый URL) — о семантике `fileMatch` он не говорит ничего. Выведенное следствие «`fileMatch` — шаблон имени, а не путь» реализации противоречит: паттерн префиксуется `**/` и матчится глобом по всему пути, а сегменты пути в паттерне допустимы. То есть возможность сузить наведение схемы каталогом существует, а план принимает риск («схема наведётся и на одноимённый файл в чужом проекте») как неустранимый.
- **trigger**: воспроизводится в нормальной работе — файл с тем же именем в открытом чужом репозитории
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:130-134`
- **evidence**:
  ```ts
  // microsoft/vscode-json-languageservice@main src/services/jsonSchemaService.ts:98-104
  if (patternString[0] === PATH_SEP) { patternString = patternString.substring(1); }
  this.globWrappers.push({ regexp: createRegex('**/' + patternString, { extended: true, globstar: true }), include });
  // microsoft/vscode@main src/vs/workbench/api/common/jsonValidationExtensionPoint.ts:39
  // 'The file pattern (or an array of patterns) to match, for example "package.json" or "*.launch". Exclusion patterns start with \'!\''
  ```
- **verification**: confirmed
- **verification_note**: ложное следствие процитировано как основание решения дважды: `00-overview.md` (раздел «Хранение правил», «риск принят») и `02-core.md` пакет 02-B («Имя характерное: `fileMatch` … шаблон имени, а не путь»). В `contribution-points.md` слово `fileMatch` встречается только внутри JSON-примера (:847) — источник факта в принципе не может подтверждать это следствие
- **fix_direction**: заменить источник факта 17 на описание вклада `jsonValidation` из кода расширяемости и на реализацию матчинга, следствие переписать (паттерн — глоб по пути, сегменты каталогов допустимы), после чего пересмотреть в 00-overview и 02-B решение «риск принят» — у него появляется дешёвая альтернатива

---

### claude-05

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: reliability
- **title**: Тип «цитата» при отсутствии цитаты — факты 2 и 8
- **mechanism**: Правило 2 таблицы объявляет ссылку на файл без цитаты недействительной, а правило 3 — вывод в роли цитаты дефектом. Факт 8 («Декорации требуют `resourceUri` и провайдер регистрируется глобально») помечен `Тип: цитата`, но не содержит ни одной цитаты и ни одного номера строки — только перечисление имён файлов и символов, то есть ровно та форма, против которой правило 2 введено. Факт 2 помечен `Тип: цитата`, а несёт пересказ кода («таблица `syntaxes`: `**` → `bold`») плюс фрагмент CSS; прямого утверждения источника о том, что bold доступен только за proposed API, в строке нет, хотя цитируемый текст для этого существует.
- **trigger**: воспроизводится в нормальной работе — перепроверяющий не может сверить утверждение, не переоткрыв весь файл
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:23-27` (факт 2), `docs/plans/projects-tree/api-facts.md:71-74` (факт 8)
- **evidence**:
  ```text
  # api-facts.md:71-73 — весь текст факта 8, цитаты нет
  **8. Декорации требуют `resourceUri` и провайдер регистрируется глобально.** Тип: цитата.
  `vscode.d.ts`, `window.registerFileDecorationProvider`; `treeView.ts` запрашивает `fileDecorations`
  по `resourceUri` элемента.
  ```
- **verification**: confirmed
- **verification_note**: по существу оба факта верны. Для 8: `vscode.d.ts:11830-11835` — «Register a file decoration provider» без какой-либо привязки к view, а `treeView.ts:1436-1444` передаёт `fileDecorations` только в ветке, где у узла есть `resource`. Для 2: proposed-файл существует и прямо говорит «Bold, italics, and strikethrough formatting, but only when the syntax wraps the entire string». Факт 8 при этом нагружен: `03-tree-view.md` 03-A строит на нём решение «`TreeItem.resourceUri` задаётся всегда»
- **fix_direction**: дать в обеих строках дословные цитаты с номерами строк (для факта 8 — доку `registerFileDecorationProvider` и точку чтения `fileDecorations` в `treeView.ts`; для факта 2 — комментарий из proposed-файла), либо честно переставить тип на `вывод` с перечислением посылок

---

### claude-06

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: architecture
- **title**: Обратный проход: 12 утверждений об API, на которые опираются решения, в таблице отсутствуют
- **mechanism**: Правило 1 таблицы объявляет её исчерпывающей («ни одно решение плана не опирается на утверждение об API, отсутствующее в этой таблице»). Проход по этапам даёт 12 таких утверждений, каждое — обоснование конкретного решения, а не проходное упоминание: (1) Settings Sync не переносит файл из глобального хранилища — обоснование «названной цены» и записи в README (00-overview, 02-B); (2) `.cmd`/`.bat` не запускаются из Node без `shell: true` — обоснование того, что массив аргументов на Windows не защищает и `.cmd`-цели трактуются как `terminal` (04-A); (3) синхронный `RegExp` в Node прервать нечем — обоснование замены бюджета времени проверкой сложности (02-A); в таблице фигурирует только в секции опровергнутых, без источника; (4) семантика `TreeItem.id` и протечка состояния раскрытия — обоснование `NodeKey` вместо пути (03-A); (5) `explorer.decorations.colors`/`.badges` отключают носитель выделения — входит в DoD 03-B и в текст онбординга; (6) `contributes.keybindings` умеет аргументы команды — заявленная функция 04-C; (7) `%key%`/`package.nls*.json` для строк манифеста — 03-D (факт 19 покрывает только рантайм-бандлы); (8) `viewsWelcome` с `when` плюс `setContext` для двух пустых состояний — 05-A; (9) `contributes.colors` и `workbench.colorCustomizations` — 03-B; (10) `webview.setState` сохраняет несохранённые правки при скрытии панели — 06-A; (11) `globalStorageUri` как место кэша и файла правил — 07-A, 00-overview; (12) «все используемые API старше 1.85, самое свежее — поле `l10n`, стабильно с 1.73» — само утверждение об API, и именно оно обосновывает значение `engines.vscode` (01-D).
- **trigger**: воспроизводится в нормальной работе — любое из этих решений исполняется без проверенной посылки; класс ошибок round 01/02 состоял ровно в этом
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md` правило 1 (строка 8) против `00-overview.md`, `01-monorepo-and-tooling.md`, `02-core.md`, `03-tree-view.md`, `04-actions.md`, `05-onboarding.md`, `06-rules-editor.md`, `07-cache-and-reactivity.md`
- **evidence**:
  ```text
  # 00-overview.md: «Цена, названная явно: **файл не синхронизируется** между машинами через Settings Sync»
  # 04-A: «`.cmd`/`.bat`-обёртки … не запускаются без `shell: true`, то есть массив аргументов там не защищает»
  # 01-D: «все используемые API старше этой версии (самое свежее — поле `l10n`, стабильно с 1.73)»
  ```
- **verification**: confirmed
- **verification_note**: выборочно проверено, что часть этих утверждений верна по существу (например, поведение Node на Windows для `.bat`/`.cmd` и наличие `l10n` в 1.85), то есть находка про пробел в таблице, а не про ложность утверждений; проверка каждого из 12 в задание не входила. Пункты (2) и (3) — про Node, а не про VS Code; заголовок таблицы («Факты о VS Code API») их формально не покрывает, при том что правило 1 говорит про «утверждение об API» без сужения — эту границу тоже надо решить
- **fix_direction**: либо внести перечисленные утверждения в таблицу по общему контракту (цитата + тип), либо сузить правило 1 до явно названного подмножества и завести второй реестр для утверждений о рантайме Node и о поведении редактора вне API; ключевой пункт — (12): пока он не в таблице, значение `engines.vscode` держится на непроверенном утверждении

---

### claude-07

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: deps
- **title**: Таблица квотирована по `main`, план уже фиксирует `^1.85.0`; собственное условие перепроверки не выполнено
- **mechanism**: Шапка таблицы объявляет базой `microsoft/vscode@main` и ставит условие «При фиксации `engines.vscode` перепроверить». Условие уже наступило: `01-D` фиксирует `engines.vscode` = `^1.85.0` значением, а не обещанием. Перепроверка не проводилась, и это видно машинно: у факта 13 процитированный член API в 1.85.0 отсутствует вовсе, а все номера строк из `vscode.d.ts` относятся к `main` и в 1.85 не совпадают.
- **trigger**: воспроизводится в нормальной работе — сверка любой строки таблицы против `@types/vscode` целевой версии
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:14-15` и `docs/plans/projects-tree/api-facts.md:103-106`
- **evidence**:
  ```text
  # grep -c "shellIntegration" vscode.d.ts@1.85.0  -> 0
  # grep -n "shellIntegration" vscode.d.ts@main    -> 7721: readonly shellIntegration: TerminalShellIntegration | undefined;
  # sendText: main 7731  /  1.85.0 7336   (сдвиг ~400 строк, якоря таблицы указывают на main)
  ```
- **verification**: confirmed
- **verification_note**: `sendText(text, shouldExecute)`, `TreeItemLabel.highlights`, `registerFileDecorationProvider`, `createTerminal(name, shellPath, …)` и абзац про поле `l10n` в 1.85.0 присутствуют — то есть решения плана от этого не рушатся. Факт 13 при этом описывает API, которого на целевой планке нет, а его следствие («`executeCommand` shell integration не является заменой `sendText`») на 1.85 держится по более сильной причине: этого API там просто не существует
- **fix_direction**: зафиксировать в шапке таблицы обе базы — целевую версию `engines.vscode` и ревизию `main`, из которой взяты якоря, — и по каждой строке отметить доступность на целевой планке; факт 13 переформулировать под 1.85 либо перенести в раздел про будущее поднятие планки

---

### claude-08

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: Факт 2: номер строки указывает на сигнатуру `processLabel`, а не на цитируемую таблицу `syntaxes`
- **mechanism**: Якорь `treeView.ts:1337` — сигнатура `processLabel`; таблица `syntaxes` объявлена на :1356, а отображение `**` → `bold` — на :1358. Ссылка на строку 1337 приведённого в скобках содержания не содержит.
- **trigger**: воспроизводится в нормальной работе — сверка по указанной строке содержания не находит
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:23-26`
- **evidence**:
  ```ts
  // treeView.ts:1337  private processLabel(label: string | IMarkdownString | undefined, matches: …
  // treeView.ts:1356  const syntaxes = [
  // treeView.ts:1358  { open: '**', close: '**', mark: () => { bold = true; } },
  ```
- **verification**: confirmed
- **verification_note**: диапазон CSS в той же строке (`iconlabel.css:81-84`) верен: селекторы на 81-82, `font-weight: bold` на 83, закрывающая скоба на 84
- **fix_direction**: указать строку объявления `syntaxes` и строку самого отображения `**` → `bold`

---

### claude-09

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: Факт 9: вторая цитата приписана `onDidChangeFileDecorations`, а находится в доке `provideFileDecoration` и обрезана до потери требования
- **mechanism**: Строка вводит вторую цитату словами «и `onDidChangeFileDecorations`:», но текст принадлежит doc-комментарию `provideFileDecoration`. Цитата обрезана на «to the editor», а отброшенный хвост «via the `onDidChangeFileDecorations`-event» и есть требование, которое пакет 03-B на неё вешает («требуется явно сигналить `onDidChangeFileDecorations` для предков»).
- **trigger**: воспроизводится в нормальной работе — обрезанная цитата не подтверждает требование, которое из неё выведено
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:76-80`
- **evidence**:
  ```ts
  // vscode.d.ts@main:8299-8305 — комментарий метода provideFileDecoration
  * *Note* that this function is only called when a file gets rendered in the UI.
  * This means a decoration from a descendent that propagates upwards must be signaled
  * to the editor via the {@link FileDecorationProvider.onDidChangeFileDecorations onDidChangeFileDecorations}-event.
  ```
- **verification**: confirmed
- **verification_note**: первая цитата факта 9 («A flag expressing that this decoration should be propagated to its parents», :8269-8270) дословна; заголовок факта верен
- **fix_direction**: перенести атрибуцию на `provideFileDecoration` и дотянуть цитату до конца предложения — тогда требование пакета 03-B опирается на текст, а не на его усечение

---

### claude-10

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: Факт 7: «бросает исключение» без указания, что исключение перехватывается и расширению не видно
- **mechanism**: Заголовок и следствие описывают нарушение как брошенное исключение. Фактически `FileDecoration.validate` вызывается внутри `try` на стороне extension host, а исключение перехватывается и уходит в `logService.warn`; расширение никакой ошибки не получает — наблюдаемый эффект только в том, что декорация не попадает в ответ.
- **trigger**: только на рукотворном входе — бейдж длиннее двух символов, который валидация плана (02-B) обязана отсечь раньше
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:52-69`
- **evidence**:
  ```ts
  // extHostDecorations.ts:102-108
  try { FileDecoration.validate(data); … result[id] = <DecorationData>[…]; }
  catch (e) { this._logService.warn(`INVALID decoration from extension '…': ${e}`); }
  ```
- **verification**: confirmed
- **verification_note**: сам блок цитаты (`extHostTypes.ts:2581-2599`) дословен, включая обе ветки `throw` и проверку пустой декорации; следствие «декорация отбрасывается целиком вместе с цветом» подтверждается тем, что `result[id]` не выставляется. Решения плана (валидация правил отвергает длинный бейдж, адаптер не создаёт пустую декорацию) верны и от этой правки не меняются
- **fix_direction**: дописать в следствие, что ошибка не наблюдаема расширением (только warn в логе host), — иначе строка читается как приглашение полагаться на try/catch вокруг создания декорации

---

### claude-11

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: Факт 5: рекомендация источника подана как техническое ограничение, цитата обрезана
- **mechanism**: Заголовок утверждает «Id view уникален глобально»; источник говорит «This should be unique across all views. It is recommended to include your extension id…», то есть нормативное требование к автору, а не процитированное принуждение платформы. Цитата обрезана на «`onView:${id}` event», отброшено «to `activationEvents`» — та часть, на которую 03-C ссылается решением «`activationEvents` перечисляют оба `onView:<id>`».
- **trigger**: недостижим — решение плана (два view с разными id) от формулировки не зависит
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:42-44`
- **evidence**:
  ```ts
  // viewsExtensionPoint.ts:134 (и :184 для второй схемы)
  'Identifier of the view. This should be unique across all views. … Also to trigger activating your
   extension by registering `onView:${id}` event to `activationEvents`.'
  ```
- **verification**: confirmed
- **verification_note**: цитата в остальном дословна, включая элизию про `registerTreeDataProviderForView`; строка источника указана без номера, фактически 134 и 184
- **fix_direction**: привести формулировку источника как есть и, если решение 03-C опирается на принуждение платформы, добавить посылку из места регистрации view; хвост цитаты про `activationEvents` восстановить

---

## Coverage

**Прямой проход (23/23 строки открыты в названном источнике).**

- Проверено по источнику: **23 из 23**. Все источники получены с `raw.githubusercontent.com`: `microsoft/vscode@main` (`vscode.d.ts`, `extHostTypes.ts`, `extHostTreeViews.ts`, `treeView.ts`, `viewsExtensionPoint.ts`, `iconlabel.css`, `extHostDecorations.ts`, `jsonValidationExtensionPoint.ts`, `contextKeyService.ts`, `vscode.proposed.treeItemMarkdownLabel.d.ts`), `microsoft/vscode@1.85.0` (`vscode.d.ts` — для проверки доступности на целевой планке), `microsoft/vscode-docs@main` (`contribution-points.md`, `commands.md`, `when-clause-contexts.md`, `extension-guides/workspace-trust.md`, `extension-capabilities/common-capabilities.md`), `microsoft/vscode-vsce@main` (`src/validation.ts`), `microsoft/vscode-json-languageservice@main` (`src/services/jsonSchemaService.ts`), `github/docs@main` (`content/actions/reference/workflows-and-actions/contexts.md`).
- Подтверждено дословно, с верным якорем и верным типом, расхождений нет: **13** — факты **1, 4, 10, 11, 12, 14, 15, 16, 19, 20, 21, 22, 23**. Из них отдельно отмечу: факт 20 — единственный, честно помеченный `вывод`, и посылки :1005/:248 совпадают построчно; факт 23 — таблица контекстов GitHub сверена построчно (:100 и :110), `secrets` в обеих строках действительно отсутствует; факт 22 — регулярка и обе функции `validatePublisher`/`validateExtensionName` совпадают, запрет точки из регулярки следует; факт 4 — оба фрагмента дословны (:329, :810), и следствие «молчаливый no-op» подтверждено сверх цитаты по `_refresh` (:790-805, пустой список handles → `Promise.resolve(undefined)`).
- С расхождениями: **10** — факты **2, 3, 5, 6, 7, 8, 9, 13, 17, 18**. Материальных (искажают смысл источника или обоснование решения плана): **6** — факты 3, 6, 8, 13, 17, 18. Нематериальных (номер строки, атрибуция члена API, усечение цитаты, нормативность формулировки): **4** — факты 2, 5, 7, 9.
- Проверка типа `цитата`/`вывод` по всем 23 строкам: нарушений типа **2** (факты 2 и 8 — тип `цитата` при отсутствии цитаты), фактов, помеченных `вывод` неправомерно, **нет**.
- Отдельно проверены четыре дефекта round 02 — все действительно исправлены: длина `badge` (факт 7 — ограничение есть, код совпал построчно), контекст `secrets` (факт 23 — обе строки таблицы GitHub сверены), источник факта про `l10n` (факт 19 — текст найден в `vscode.d.ts:18189-18191`, а в `common-capabilities.md` слова `l10n` действительно 0 вхождений), статус факта про `menus` (факт 20 — помечен `вывод`). Строки секции «Опровергнутые утверждения» сверены с фактами, на которые они ссылаются; расхождений нет, кроме отсутствия источника у строки про синхронный `RegExp` (вошло в claude-06).

**Обратный проход (`00-overview.md`, `01`..`07` — прочитаны полностью).**

- Незаписанных утверждений об API, на которые опираются решения: **12** (перечислены в claude-06). Ссылки плана на факты по номерам сверены в обратную сторону: все 23 номера, упомянутые в этапах, указывают на существующие строки таблицы, «висячих» номеров нет; при этом три ссылки ведут на дефектные строки (факт 3 в 00-overview/03-B/02-A, факт 17 в 00-overview/02-B, факт 6 неявно в 03-C).
- Признано чистым: соответствие номеров фактов между таблицей и этапами; наличие владельца пакета у каждого манифестного вклада, упомянутого в фактах 15-19 и 21 (все привязаны к 01-D, 03-C, 03-D, 05-B); отсутствие в этапах решений, опирающихся на proposed API (заявление «proposed API не используется» сверено с фактом 2 — bold действительно не используется).

**Границы проверки.** Не проверялось: содержательная корректность решений плана за пределами их опоры на факты; полнота 12 незаписанных утверждений по существу (проверены выборочно — Node на Windows и наличие `l10n` в 1.85); история round 01/02 сверх четырёх названных в задании дефектов; доступность на планке 1.85 всех 23 строк построчно (проверены `sendText`/`shouldExecute`, `highlights`, `registerFileDecorationProvider`, `createTerminal`, `l10n`, `shellIntegration`).

## Отклонённые находки (`refuted`)

- `—` | Факт 13 «`Terminal.shellIntegration` может не активироваться никогда» как ложная цитата | цитата дословна на `main` (`vscode.d.ts:7717-7719`), якорь 7717-7721 корректен; дефект не в цитате, а в её базе — вынесен в claude-07
- `—` | Факт 10 как обрезанная цитата (два фрагмента поданы двумя строками цитаты) | оба фрагмента дословны, :459 — описание команды, :462 — пункт `_options_`; смысл не меняется
- `—` | Факт 16 как склейка двух мест источника в одну цитату | склейка :504 + :506 дословна и смысл сохраняет; строка `#### Unsupported JSON Schema properties` действительно внутри `contributes.configuration`
- `—` | Факт 7 «заголовок обещает лимит в два символа, а код считает графемы» | `nextCharLength` вызывается дважды, то есть ровно «не более двух символов» в смысле code points/графем; расхождения с заголовком нет
