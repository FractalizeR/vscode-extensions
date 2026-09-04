# Находки — native-claude (round 07, этап 04 ProjectsTree)

Ревью проведено фасилитатором в основном потоке, а не отдельным агентом: три агента-ревьюера подряд
(`comprehensive` на двух моделях, обёртки `qwen` и `codex`) были убиты сторожевым таймером харнесса
с «no progress for 600s», в транскриптах последняя запись — `[Request interrupted by user]`. Названо
прямо, потому что влияет на вес голоса: предмет ревью писали шесть исполнителей, фасилитатор его не
писал, но и полной независимости у этого голоса нет.

`qwen` недоступен: обёртка вернула `403 Access to model denied` за 1.5 s (см.
`raw/qwen-refusal.txt`). Это отказ, а не отсутствие находок; собственным разбором не подменялся.

### native-claude-01

- **reviewer**: native-claude
- **severity**: HIGH
- **kind**: logic
- **domain**: correctness
- **title**: `terminal.cwd` квотируется под шелл и в этом виде уходит в `TerminalOptions.cwd`, который шелл не разбирает — рабочий каталог становится путём с кавычками в имени
- **mechanism**: `runTerminal` рендерит `spec.cwd` с целью `{ kind: 'shell', shell }`, то есть каждое
  подставленное значение проходит `quoteForShell`. Для `zsh`/`bash` это безусловное оборачивание в
  одинарные кавычки (`quoteForPosixShell` квотирует всегда, а не только при наличии метасимволов).
  Результат передаётся в `TerminalOptions.cwd` — параметр API, который получает путь и никакому шеллу
  не отдаётся: кавычки становятся частью имени каталога. Терминал открывается не там, где просил
  пользователь (VS Code молча падает в домашний каталог), причём для **любого** пути, а не только для
  пути со спецсимволами. Под `cmd` хуже: путь с `%` (`%APPDATA%` в составе пути) даёт
  `RenderError('unsafeValue')`, и действие не выполняется вовсе — по причине, которой нет.
  Первоисточник ошибки — докомментарий контракта в ядре (`projects/actions/action.ts`: «`cwd` — A
  `render` template, target `{ kind: 'shell'; shell }` — same shell as `command`»), пакет 04-A
  выполнил его дословно. `RenderTarget` для этого случая уже существует и задокументирован:
  `{ kind: 'literal' }` — «the string reaches no interpreter (e.g. a terminal tab name)», с
  сохранением безусловного отказа по управляющим символам.
- **trigger**: любое действие вида `terminal` с `cwd`, содержащим подстановку (`cwd: "${path}"`) —
  то есть заявленный в плане флагманский кейс «запустить OpenCode в папке проекта».
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/commands/actions/terminal.ts:35-37`;
  контракт — `packages/projects-tree/src/projects/actions/action.ts` (докомментарий `cwd`);
  квотирование — `packages/projects-tree/src/projects/actions/quoting.ts:37-39`
- **evidence**:
  ```ts
  const target = { kind: 'shell', shell: spec.shell } as const;
  const command = render(spec.command, node, target);
  const cwd = spec.cwd === undefined ? undefined : render(spec.cwd, node, target);
  ```
  ```ts
  function quoteForPosixShell(value: string): string {
    return `'${value.replaceAll("'", String.raw`'\''`)}'`;
  }
  ```
- **verification**: verified. Дефект **закреплён тестом**, который его же и утверждает —
  `terminal.test.ts:58-73`, ожидание `cwd: "'/work/my project'"`. То есть это не пропуск покрытия, а
  зафиксированное ожидание: тест придётся править вместе с кодом.
- **fix_direction**: рендерить `cwd` с целью `{ kind: 'literal' }` (отказ по управляющим символам
  сохраняется), поправить докомментарий `cwd` в `projects/actions/action.ts` — он источник ошибки, —
  и перевернуть ожидание в `terminal.test.ts` на путь без кавычек. Заодно проверить, что тест после
  правки краснеет на возврате шелл-цели.

### native-claude-02

- **reviewer**: native-claude
- **severity**: MEDIUM
- **kind**: contract
- **domain**: maintainability
- **title**: `${rootPath}` в шаблонах действий получает `rootId`, а не путь корня — контракт `toRenderNode` нарушен во всех четырёх местах вызова
- **mechanism**: `toRenderNode(node, rootPath)` в собственном докомментарии заявляет, что `rootPath`
  — отдельный параметр именно потому, что `NodeFacts` несёт `rootId`, «an opaque key, not the root's
  filesystem path». Все четыре вызывающих места передают туда `node.facts.rootId`. Сегодня значение
  верное только по совпадению: `configuration/settings.ts` назначает `id` равным нормализованному
  пути («The path doubles as the root's id»). Как только id корня перестанет быть путём — а этап 07
  прямо назван местом, где идентичность корней будет пересматриваться через `identity()` из
  `discovery/file-system.ts`, — `${rootPath}` в пользовательских шаблонах молча начнёт подставлять
  ключ вместо пути, то есть подставит в шелл/URI строку, которой пользователь не просил. Ни один
  тест этого не поймает: тесты передают в `toRenderNode` путь напрямую.
- **trigger**: смена схемы `id` корня (этап 07, дедупликация симлинков/регистра) при любом шаблоне,
  использующем `${rootPath}`.
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/commands/actions/render-node.ts:6-18`;
  вызовы — `run-primary-action.ts:42`, `run-action.ts:66`, `open-in-window.ts:37`,
  `show-actions.ts:53`
- **evidence**:
  ```ts
  await runActionById(getRegistry(), runner, actionId, toRenderNode(node, node.facts.rootId));
  ```
  ```ts
  // render-node.ts
  * `rootPath` is a separate parameter, not read off `node`: `NodeFacts` carries
  * `rootId`, an opaque key, not the root's filesystem path
  ```
- **verification**: verified чтением всех четырёх вызовов и `parseRootEntry`.
- **fix_direction**: разрешать путь корня по `rootId` через уже доступный командам `readRoots()`
  (или передавать в команды `rootPathOf: (rootId) => string | undefined`), и не запускать действие,
  если корень исчез из настроек. Альтернатива — объявить в контракте, что `rootId` **и есть** путь, и
  тогда убрать второй параметр вовсе; но это закрепляет то, что этап 07 собирается менять.

### native-claude-03

- **reviewer**: native-claude
- **severity**: LOW
- **kind**: logic
- **domain**: correctness
- **title**: Проверка «узел уже скрыт» в «Hide» классифицирует узел по фактам, где `entries` могут быть пустыми, — правило с `hasChild` мимо неё проходит
- **mechanism**: `registerHideCommand` строит вердикт из `node.facts`. Обход намеренно не читает
  каталог, если правила решаются по имени/глубине (`ClassifiedNode.entriesRead === false`, поле
  введено в 02-D ровно чтобы «нет детей» не путали с «внутрь не смотрели»), и тогда `facts.entries`
  — пустой массив. Пользовательское правило `skip` с условием `hasChild` на таком узле даст `false`,
  проверка решит «не скрыт», и в файл ляжет второе правило — тот самый «мёртвое правило», которого
  DoD 04-E запрещает.
- **trigger**: узел, чей вердикт разрешился без чтения каталога, и правило скрытия на `hasChild`.
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/commands/hidden.ts:97-110`
- **evidence**:
  ```ts
  const effectiveRules = [...file.rules, ...DEFAULT_RULES];
  const verdict = createClassifier(effectiveRules).classify(node.facts);
  ```
- **verification**: verified по контракту `entriesRead` (`discovery/walker.ts`), не прогоном.
- **fix_direction**: либо использовать вердикт, который уже посчитал обход (`node.verdict.skip`), а
  не пересчитывать по возможно неполным фактам, либо, если пересчёт нужен ради свежести правил,
  учитывать `entriesRead` и не делать выводов о `hasChild`-правилах на непрочитанном узле.

### native-claude-04

- **reviewer**: native-claude
- **severity**: LOW
- **kind**: doc
- **domain**: usability
- **title**: `terminal.terminalName` не проходит рендер, и о том, что подстановки там не работают, узнать негде
- **mechanism**: `runTerminal` передаёт `spec.terminalName` в `TerminalOptions.name` как есть.
  По контракту (`action.ts`) это и не шаблон — аннотации `render` у поля нет, — но `command` и `cwd`
  рядом шаблоны, схема правил разницы не показывает, и `${name}` в имени терминала просто окажется на
  экране литералом. Ни диагностики, ни строки в документации.
- **trigger**: `terminalName: "OpenCode: ${name}"` в файле правил.
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/commands/actions/terminal.ts:40`
- **evidence**:
  ```ts
  ...(spec.terminalName !== undefined && { name: spec.terminalName }),
  ```
- **verification**: verified чтением.
- **fix_direction**: дешевле всего — рендерить и его с целью `{ kind: 'literal' }` (имя вкладки
  никакому интерпретатору не отдаётся, а отказ по управляющим символам как раз полезен: имя вкладки
  с `\r` — это спуфинг UI). Альтернатива — оставить как есть и назвать это в описании поля в схеме.

### native-claude-05

- **reviewer**: native-claude
- **severity**: LOW
- **kind**: logic
- **domain**: reliability
- **title**: Защита файла правил по `mtime` не видит чужую запись, попавшую в ту же миллисекунду, и имеет окно между `stat` и `rename`
- **mechanism**: `writeRulesFile` сравнивает `mtimeMs` прочитанного файла с `mtimeMs` перед записью.
  Запись человека, попавшая в тот же миллисекундный тик, даёт равные значения и проходит как «файл не
  менялся»; и даже при разных значениях между `stat` и `rename` остаётся окно, в котором чужая запись
  будет затёрта. Это свойство схемы «сравнить время», а не ошибка реализации: настоящая сериализация
  требует блокировки, которой в плане нет.
- **trigger**: одновременная правка файла руками и командой «Hide» — редко, но данные теряются молча.
- **in_scope**: да (граница названа в 00-overview как «писатели сериализуются проверкой `mtime`»)
- **anchor**: `packages/projects-tree/src/editor/rules/store.ts:137-176`
- **evidence**:
  ```ts
  const conflict = describeConflict(expectedMtimeMs, currentMtimeMs);
  if (conflict !== undefined) return { ok: false, diagnostic: conflict };
  ```
- **verification**: verified чтением; воспроизведение требует гонки, прогоном не проверялось.
- **fix_direction**: ничего не менять в первом релизе, но назвать ограничение там, где его увидит
  следующий читатель — в докомментарии `writeRulesFile` и в разделе «Хранение правил». Реальное
  решение (сравнение содержимого вместо времени либо lock-файл) уместно в этапе 06, который делает
  файл правил редактируемым из UI и умножает число писателей.

## Coverage

Просмотрено полностью: `commands/actions/**` (все пять исполнителей, реестр, `runner`, `render-node`,
`applies-to`), `commands/{run-primary-action,run-action,show-actions,open-in-window,hidden,roots,
node-selection,open-project}.ts`, `configuration/trust.ts`, `rules/store.ts`, `rules/canonical-rules.ts`,
`decorations/decoration-provider.ts`, `classification/{highlight,validation}.ts`, манифест, оба канала
l10n.

Проверено целенаправленно и **дефектов не найдено**: обход гейта доверия (все пять путей запуска
сходятся в `runner.run`, исполнители недостижимы иначе — `grep` по именам исполнителей вне
`runner.ts` пуст); квотирование `command`/`process`/`uri` (каждый сток получает свою цель рендера,
`commandId` и `process.command` шаблонами не являются по контракту); сохранность чужих данных в файле
правил (`version`, `actions`, порядок и все поля правил переносятся; схема запрещает неизвестные
поля, поэтому терять нечего, кроме форматирования); отказ редактировать файл с диагностиками.

Не покрыто этим голосом: поведение на Windows (нет машины), remote-сценарий, визуальная часть
декораций, и корректность моих собственных переводов на русский — их писал я же, независимым голосом
это проверить нельзя.
