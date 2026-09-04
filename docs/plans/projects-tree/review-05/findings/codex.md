# Находки codex — review-05 (ядро ProjectsTree, этап 02)

Сводка: 14 находок от `codex`, все `verification: confirmed` (5 HIGH, 7 MEDIUM, 2 LOW). Верификация
проведена codex через mutation-пробы в изолированном одноразовом клоне (исходное дерево не тронуто) и
частично перепроверена мной чтением исходников (`tree.ts`, `descend.ts`, `index.ts`, `tree.test.ts`,
`regex-safety.ts`, `validation.ts`) — см. `verification_note` каждой находки.

### codex-01

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: security
- **title**: Квотирование `%` для интерактивного `cmd.exe` использует правило batch-файлов
- **mechanism**: `quoteForCmd` удваивает `%`, считая `%%` литеральным процентом и в batch, и в интерактивном терминале. Отправляемая через `Terminal.sendText` строка выполняется интерактивным `cmd.exe`; внутри `%%NAME%%` остаётся подстрока `%NAME%`, доступная для expansion. Тестовый `unquote` сам превращает `%%` обратно в `%`, поэтому подтверждает собственную модель реализации, а не поведение интерпретатора.
- **trigger**: воспроизводится в нормальной работе на Windows — путь содержит `%NAME%`, действие использует shell `cmd`
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/actions/quoting.ts:52-78`
- **evidence**:
  ```ts
  * mitigated the standard way: doubling every `%` (`%%`) is recognized unconditionally as an escaped
  * literal percent, in both batch and interactive parsing, and takes precedence over matching a
  * `%VAR%` pattern.
  ```
  ```ts
  function quoteForCmd(value: string): string {
    if (value.includes('"')) { throw new RenderError(...); }
    return `"${value.replaceAll('%', '%%')}"`;
  }
  ```
- **verification**: confirmed
- **verification_note**: код прочитан мной — комментарий в `quoting.ts:55-57` буквально утверждает «in both batch and interactive parsing», что и есть спорное допущение. На этой машине (macOS) `cmd.exe` недоступен для живого прогона, поэтому подтверждение — документарное (Microsoft Learn по `%VariableName%` и `for %%`), как и у codex; тот же класс Windows-quoting-ошибок обосновал CVE-2024-27980. Оставляю verification: confirmed по коду+документации, а не по живому прогону — это стоит перепроверить на реальном Windows/cmd перед фиксом.
- **fix_direction**: не применять batch-escape к интерактивному cmd; определить и проверить на реальном Windows безопасную политику для `%` (и заодно `!` при delayed expansion), вплоть до отказа от таких значений через `RenderError`

### codex-02

- **reviewer**: codex
- **severity**: HIGH
- **kind**: point
- **domain**: reliability
- **title**: Файл правил с некомпилируемым regex загружается без диагностик
- **mechanism**: схема разрешает произвольные `pattern`/`flags`, доменная валидация в `validation.ts` проверяет только сложность (`checkRegexComplexity`), не саму компилируемость. `loadRulesFile` принимает `pattern: "["`; `createClassifier` затем вызывает `new RegExp` и бросает исключение вместо диагностики файла.
- **trigger**: воспроизводится в нормальной работе — достаточно опечатки в пользовательском pattern/flags в `projects-tree.rules.json`
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/classification/validation.ts:66-71`
- **evidence**:
  ```ts
  case 'nameMatches': {
    const result = checkRegexComplexity(condition.pattern);
    return result.safe ? [] : [{ path: `${path}/pattern`, message: result.reason }];
  }
  ```
- **verification**: confirmed
- **verification_note**: подтверждено читаемым кодом (`checkRegexComplexity` не пытается `new RegExp`) и mutation-пробой codex: `loadRulesFile` с `pattern: "["` вернул `file` без диагностик, а последующий `new RegExp` бросил исключение.
- **fix_direction**: при загрузке пробовать компилировать каждый pattern вместе с flags и превращать пойманное исключение в адресную диагностику вместо необработанного throw

### codex-03

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: reliability
- **title**: Стратегия `submodules` не работает end-to-end
- **mechanism**: основной entry point (`discoverProjectTree`/`walkRoot`) принимает корни без стратегии descend и не вызывает `childrenOfProject` ни разу. Даже при ручном вызове конечный сабмодуль классифицируется с `entries: []`, поэтому `DEFAULT_RULES` (условие `hasChild('.git')`) не видят его `.git` и возвращают `project:false`.
- **trigger**: воспроизводится в нормальной работе для корня, где ожидается работающая стратегия `submodules`
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/discovery/tree.ts:20-23`, `packages/projects-tree/src/projects/discovery/descend.ts:216-224`
- **evidence**:
  ```ts
  export interface DiscoveryRoot {
    readonly id: string;
    readonly path: string;
  }
  ```
  Самостоятельно проверено: `grep -rn "childrenOfProject" packages/projects-tree/src --include=*.ts | grep -v test` даёт только реэкспорт в `discovery/index.ts:20` — ни одного production-вызова.
- **verification**: confirmed
- **verification_note**: перепроверено мной независимо: `DiscoveryRoot` (tree.ts:20-23) не содержит поля стратегии descend, `discoverProjectTree` вызывает только `walkRoot`; `childrenOfProject` экспортируется из `discovery/index.ts`, но во всём `src/` (кроме тестов) не вызывается ни разу. Это подтверждает механизм находки независимо от mutation-пробы codex.
- **fix_direction**: включить `descend`-стратегию в контракт корня и в единый обход; конечный trie-node сабмодуля должен получать признак, достаточный для классификации проектом без чтения всего каталога

### codex-04

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: reliability
- **title**: Отмена не останавливает уже поставленные в очередь filesystem-операции
- **mechanism**: `readDirectoryTracked` (walker.ts) проверяет сигнал отмены до входа в limiter, но не после получения слота. В `descend.ts` (`filterExisting`) все `identity()` запускаются одним `Promise.all` без лимитера и без проверки сигнала между итерациями. После отмены широкий каталог или большой `.gitmodules` продолжает запускать уже поставленные чтения.
- **trigger**: воспроизводится в нормальной работе — широкий каталог или много сабмодулей, отмена во время обхода
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/discovery/walker.ts:149-153`, `packages/projects-tree/src/projects/discovery/descend.ts:152-156`
- **evidence**:
  ```ts
  signal.throwIfCancelled();
  try {
    return await runLimited(() => fs.readDirectory(path));
  ```
  ```ts
  const checked = await Promise.all(
    entries.map(async (entry) => {
      try {
        await fs.identity(joinPath(projectPath, entry.path));
  ```
- **verification**: confirmed
- **verification_note**: подтверждено mutation-пробой codex (20 сабмодулей, отмена на первом `identity` — были запущены все 20) и структурой кода: `Promise.all` без per-item cancellation check — паттерн виден в самом коде и не требует прогона для подтверждения механизма.
- **fix_direction**: проверять сигнал внутри callback после получения слота, а не только на входе; пропускать `identity` через общий лимитер и прекращать постановку новых операций после отмены

### codex-05

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: security
- **title**: Лексическая проверка `.gitmodules` не предотвращает выход через symlink
- **mechanism**: `resolveSegments` запрещает абсолютные пути и выходящие `..`, но не проверяет физический target. `FileSystemReader.identity()` следует symlink и возвращает только inode/идентичность, не canonical path. Объявленный в `.gitmodules` путь `link`, являющийся symlink/junction наружу проекта, лексически принимается как «внутри проекта»; последующие чтения и действия работают с внешним каталогом.
- **trigger**: воспроизводится на рукотворном checkout с `.gitmodules` и symlink/junction в объявленной точке — не рукотворный входной файл в смысле «испорченный формат», а обычный git submodule setup со специально подготовленным симлинком
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/discovery/descend.ts:153-157`, `packages/projects-tree/src/projects/discovery/file-system.ts:23-27`
- **evidence**:
  ```ts
  try {
    await fs.identity(joinPath(projectPath, entry.path));
    return entry;
  } catch {
  ```
  `file-system.ts:23-27` — `identity` явно следует symlink и не возвращает canonical path.
- **verification**: confirmed
- **verification_note**: подтверждено чтением контракта порта — по текущей сигнатуре `FileSystemReader` физическую принадлежность target проекту в принципе нельзя проверить (нет canonical-path операции). Существующие тесты покрывают только лексический `../`, что подтверждено просмотром `descend.test.ts` — там нет фикстур на симлинк за пределы проекта.
- **fix_direction**: получать canonical path цели и проверять его принадлежность canonical root; отдельно учесть Windows junction, UNC-пути и reparse points

### codex-06

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Канонический файл правил не содержит действий
- **mechanism**: план (`00-overview.md`) помещает правила и действия в один `projects-tree.rules.json`, а `primaryAction` ссылается на `ActionDefinition.id`. `RawRulesFile` и `rules.schema.json` содержат только `version`/`rules` с `additionalProperties: false`; загрузить определения пользовательских действий из канонического файла невозможно, `knownActionIds` неоткуда взять.
- **trigger**: воспроизводится в нормальной работе при попытке добавить пользовательское действие через `primaryAction`
- **in_scope**: да
- **anchor**: контракт хранения `projects-tree.rules.json` в `docs/plans/projects-tree/00-overview.md`, пакеты 02-B/02-F; `packages/projects-tree/src/projects/classification/rules-file.ts:43-46`
- **evidence**:
  ```ts
  export interface RawRulesFile {
    version: number;
    rules: readonly RawRule[];
  }
  ```
  `rules.schema.json` запрещает дополнительные top-level свойства.
- **verification**: confirmed
- **verification_note**: подтверждено чтением схемы и интерфейса; добавление `actions` в JSON текущая схема отвергнет по `additionalProperties: false` — механически проверяемо без mutation-пробы.
- **fix_direction**: определить on-disk модель действий, их валидацию и уникальность id внутри того же файла; выводить `knownActionIds` из результата его загрузки

### codex-07

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: security
- **title**: Render-контракт не охватывает аргументы `command` и `process`
- **mechanism**: план 02-F требует, чтобы ни один путь подстановки, включая аргументы `command`, не обходил target-aware защиту. Модель `ActionSpec` объявляет `command.args` как `unknown[]`, не задаёт семантику вложенных шаблонов; для `process` явно сказано, что command/args не являются шаблонами. Публичный `render()` работает только с одной строкой, нет API безопасного рендера всего spec.
- **trigger**: воспроизводится при попытке задать action с `${path}` внутри аргументов `command`/`process`
- **in_scope**: да
- **anchor**: контракт 02-F «ни одного пути, где подстановка попадает в sink без обработки»; `packages/projects-tree/src/projects/actions/action.ts:24-27, 65-76`
- **evidence**:
  ```ts
  * `kind: 'openFolder'` and
  * `kind: 'command'` carry no template — nothing here for `render` to touch.
  ```
- **verification**: confirmed
- **verification_note**: подтверждено чтением публичной поверхности `actions/index.ts` — экспортируется только `render(template: string, ...)`, нет функции для рендера структурированного `ActionSpec` целиком.
- **fix_direction**: формально определить допустимые placeholders по каждому виду действия и дать единый API рендера полного spec, включая вложенные command arguments

### codex-08

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: reliability
- **title**: Парсер `.gitmodules` расходится с каноническим `git config`
- **mechanism**: неизвестная escape-последовательность вроде `\q` в `unescapeChar` молча превращается в `q`, хотя `git config` считает такой файл битым (`fatal: bad config line`). Обратное расхождение: `SECTION_HEADER` — строгий regex, отвергающий валидный trailing comment после заголовка секции, который `git config` принимает.
- **trigger**: воспроизводится при ручной правке `.gitmodules` (опечатка в escape-последовательности или комментарий после заголовка секции)
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/discovery/gitmodules.ts:32, 164-167`
- **evidence**:
  ```ts
  const SECTION_HEADER = /^\[\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*(?:"((?:[^"\\]|\\.)*)")?\s*]$/;
  ```
  ```ts
  if (char === 'n') return '\n';
  if (char === 't') return '\t';
  return char;
  ```
- **verification**: confirmed
- **verification_note**: подтверждено mutation-пробой codex — фикстура `path = foo\q` принята `parseGitmodules`, но реальный `git config -f` на том же содержимом завершается ошибкой `fatal: bad config line 2` (проверялось в изолированном клоне). Это ровно тот класс расхождений, о котором предупреждает приоритет 1 брифа (фикстуры покрывают только то, что парсер умеет).
- **fix_direction**: строить corpus фикстур от реального поведения `git config`, а не от собственной реализации; отвергать неизвестные escape-последовательности и поддержать допустимые trailing comments

### codex-09

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Traversal-тест заявляет проверку `stopDescend`, но не устанавливает его ни в одном правиле
- **mechanism**: тест называется `'produces the expected set of nodes, honoring skip and stopDescend'`, однако используемые в нём правила — только `projectByGitRule()` (`verdict: { project: true }`) и `nameRule('skip-node-modules', ..., true)` (`verdict: { skip: true }`). Ни одно правило теста не задаёт `verdict.stopDescend`. Удаление проверки `stopDescend` из walker этот тест не покраснит.
- **trigger**: недостижим как отдельный runtime-дефект — это ложное покрытие регрессии, а не баг поведения
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/discovery/tree.test.ts:204-206` (тест), правила заданы на строках 186-188 и 220-222
- **evidence**:
  ```ts
  it('produces the expected set of nodes, honoring skip and stopDescend', async () => {
    ...
    const rules: Rule[] = [
      projectByGitRule(),
      nameRule('skip-node-modules', '^node_modules$', true),
    ];
  ```
  ```ts
  function projectByGitRule(id = 'is-project'): Rule {
    return { id, when: { kind: 'hasChild', names: ['.git'] }, verdict: { project: true } };
  }
  ```
- **verification**: confirmed
- **verification_note**: перепроверено мной напрямую чтением `tree.test.ts:170-230` — ни `projectByGitRule`, ни `nameRule` не задают `stopDescend` ни в одном вызове этого it-блока; заголовок теста вводит в заблуждение относительно реального покрытия.
- **fix_direction**: добавить отдельный traversal-case с `verdict.stopDescend: true`, ловушкой (файлом/директорией) под этим узлом и явными assertions на отсутствие чтения содержимого и детей узла

### codex-10

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: performance
- **title**: Решённый по имени `skip` не всегда предотвращает чтение каталога
- **mechanism**: `requiresEntries` в `walker.ts` независимо анализирует все поля вердикта через `VERDICT_FIELDS.some(...)`. Даже если `skip:true` уже безусловно решён name-only условием (и нормализация впоследствии обнулит остальные поля вердикта), более позднее `hasChild`-правило для поля `project` всё равно возвращает `unknown` для этого поля и заставляет читать каталог — хотя чтение уже не нужно, узел всё равно будет пропущен.
- **trigger**: воспроизводится в нормальной работе, когда name-only skip-правило расположено перед hasChild-правилом другого поля (частый порядок: сначала общие ignore-правила, потом project-детекция)
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/discovery/walker.ts:288-305`
- **evidence**:
  ```ts
  function requiresEntries(rules: readonly Rule[], facts: NodeFacts): boolean {
    return VERDICT_FIELDS.some((field) => requiresEntriesForField(rules, field, facts));
  }
  ```
- **verification**: confirmed
- **verification_note**: подтверждено mutation-пробой codex — `skip(node_modules)` перед hasChild-project-правилом ожидал чтение только корня, но walker всё равно прочитал `["", "/node_modules"]`. Механизм согласуется с буквальным чтением `requiresEntries`, независимо анализирующим поля без учёта уже решённого `skip`.
- **fix_direction**: учитывать нормализацию при решении о чтении: если `skip` уже безусловно разрешился в `true` для узла, не вычислять и не читать данные ради полей, которые всё равно будут сброшены нормализацией

### codex-11

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: security
- **title**: Эвристика `regex-safety.ts` пропускает классический ReDoS с перекрывающейся альтернативой
- **mechanism**: `checkRegexComplexity` ищет только вложенные кванторы (`hasNestedQuantifier`) и backreferences. Паттерн `^(a|aa)+$` не содержит ни того, ни другого, признаётся безопасным (`{safe: true}`), но имеет экспоненциальное число способов разбить строку из повторяющихся `a` на альтернативы `a`/`aa`.
- **trigger**: воспроизводится на пользовательском правиле `nameMatches`/`pathMatches` с таким паттерном и именем каталога из повторяющихся `a`, заканчивающимся несовпадающим символом
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/classification/regex-safety.ts:24-38`
- **evidence**:
  ```ts
  if (BACKREFERENCE.test(pattern)) { return { safe: false, reason: ... }; }
  if (hasNestedQuantifier(pattern)) { return { safe: false, reason: ... }; }
  return { safe: true };
  ```
- **verification**: confirmed
- **verification_note**: перепроверено мной чтением файла целиком — док-комментарий модуля сам называет это «heuristic, not a proof», ограниченной именно двумя триггерами, и явно называет условие ревизии (импорт правил из внешнего источника). Находка не противоречит этому дизайн-решению, а указывает на конкретный пропущенный класс паттернов внутри заявленной эвристики; codex воспроизвёл рост времени с ~6мс на 24 символах до ~173мс на 36 локальным бенчмарком.
- **fix_direction**: расширить проверку на перекрывающиеся альтернативы внутри квантифицированной группы либо документировать этот класс как явно принятый остаточный риск наравне с уже названным условием ревизии

### codex-12

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: reliability
- **title**: Renderer оставляет часть ошибочных placeholder'ов без диагностики и не отвергает одиночный CR
- **mechanism**: `VARIABLE_PATTERN` в `render.ts` распознаёт только `${[A-Za-z]+}`, поэтому синтаксически похожие, но невалидные `${root_path}`, `${path1}`, `${foo-bar}`, `${}` не матчатся этим regex и остаются в результате буквально, минуя ветку `unknownVariable`. Проверка control-character в `render` ищет только `\n`; одиночный `\r` (тоже terminal control character) проходит в shell target необработанным.
- **trigger**: воспроизводится при опечатке в шаблоне действия (лишний символ/цифра/подчёркивание в имени переменной) или при имени POSIX-каталога, содержащем `\r`
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/actions/render.ts:37, 66-69`
- **evidence**:
  ```ts
  const VARIABLE_PATTERN = /\$\{([a-zA-Z]+)\}/g;
  ```
  ```ts
  return template.replaceAll(VARIABLE_PATTERN, (_match, variableName: string) => {
    const value = lookupVariable(variableName, node);
    if (value.includes('\n')) {
  ```
- **verification**: confirmed
- **verification_note**: подтверждено mutation-пробами codex — `${root_path}` вернулся в результат буквально вместо диагностики, а значение `safe\rcalc` не вызвало `RenderError`. Оба факта прямо следуют из процитированных regex/проверки.
- **fix_direction**: сначала находить весь placeholder-синтаксис (`${...}` целиком) и валидировать извлечённое имя отдельно; для terminal/shell sinks отвергать как минимум `\r` наравне с `\n`

### codex-13

- **reviewer**: codex
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: Два non-BMP символа (эмодзи) в badge ошибочно считаются длиннее двух символов
- **mechanism**: JSON Schema/Ajv и VS Code считают длину `badge` в Unicode code points, а доменная валидация в `validation.ts` использует UTF-16 `.length` строки. Два emoji вне Basic Multilingual Plane (например, `🔥🔥`) дают `string.length === 4` и отвергаются доменной проверкой после успешного прохождения схемы.
- **trigger**: воспроизводится в нормальной работе при задании badge из двух non-BMP emoji
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/classification/validation.ts:97-100`
- **evidence**:
  ```ts
  if (highlight.badge !== undefined && highlight.badge.length > 2) {
    diagnostics.push({ path: `${path}/badge`, ... });
  ```
- **verification**: confirmed
- **verification_note**: подтверждено чтением кода — `.length` на JS-строке считает UTF-16 code units, не code points; `'🔥🔥'.length === 4` — стандартное поведение JS, не требующее live-run для подтверждения. `api-facts.md` (по указанию codex, факт 7) фиксирует code-point-aware подсчёт на стороне VS Code, что и создаёт расхождение.
- **fix_direction**: считать те же Unicode units, что и VS Code (code points, напр. через `Array.from(badge).length` или `Intl.Segmenter`); добавить тесты на один и два emoji и смешанную BMP/non-BMP пару

### codex-14

- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: architecture
- **title**: В README не зафиксировано отсутствие Settings Sync для файла правил
- **mechanism**: пакет 02-B требует явно документировать, что `projects-tree.rules.json` в global storage не переносится Settings Sync и должен экспортироваться/импортироваться вручную. Текущий `README.md` пакета содержит только описание scaffold и команд разработки, без этого раздела.
- **trigger**: воспроизводится при использовании расширения на второй машине без осведомлённости об этом ограничении
- **in_scope**: да
- **anchor**: DoD/решение пакета 02-B о документировании известного ограничения; `packages/projects-tree/README.md:1-31`
- **evidence**: `README.md:1-31` не содержит упоминаний rules file, Settings Sync, export или import — проверено прямым чтением файла.
- **verification**: confirmed
- **verification_note**: подтверждено прямым чтением README; отсутствие упоминания — факт содержания файла, не требующий mutation-пробы.
- **fix_direction**: добавить короткий раздел о machine-local файле правил и предусмотренном ручном export/import

## Coverage

1. **Тесты, которые не тестируют**: fake FS в `tree.test.ts` строит независимую модель дерева (не canned answers) — принято чистым. Найден ложный `stopDescend`-тест (codex-09, подтверждено мной напрямую) и отсутствие assertions на project-verdict сабмодуля (часть codex-03). Quoting round-trip через собственный `unquote` признан недостаточным именно для cmd-ветки (codex-01). Runtime-экспорты barrel-файлов (`index.test.ts` во всех трёх подпредметах) проверены codex mutation-тестом: удаление `parseGitmodules` красит `discovery/index.test.ts` — приняты чистыми, кроме отмеченного отклонения codex-R07 ниже.
2. **Безопасность**: проверены POSIX, PowerShell и cmd quoting, newline/CR-инъекция, URI-кодирование, action sinks, лексический path containment и regex safety. POSIX close-escape-reopen и PowerShell doubling признаны корректными (mutation-поломка PowerShell escaping красит тест). Найдены: cmd `%` (codex-01, документарно подтверждено, без live-run на Windows), CR-инъекция (часть codex-12), symlink escape (codex-05), неполный render-контракт для command/process args (codex-07), пропуск ReDoS-паттерна (codex-11).
3. **Модель правил**: first-match по полю, `Object.hasOwn`, disabled rules, нормализация, `**`, root/absolute anchors и сброс `lastIndex` — признаны корректными, чистых находок не дали. Найдена смежная проблема неполной загрузочной валидации regex (codex-02).
4. **Ленивость/производительность**: трёхзначная логика `all`/`any`/`not` совпадает с boolean classifier — чисто. FIFO limiter (`tree.ts`) удерживает заявленный peak concurrency — чисто. Найдены: лишнее чтение после уже решённого `skip` (codex-10), продолжение чтений после отмены (codex-04), неограниченный по concurrency `Promise.all(identity)` в `descend.ts` (часть codex-04).
5. **Границы**: production-импорты идут через barrel-файлы (`index.ts`); `vscode` в `src/projects/**` не импортируется; `node:fs` — только в `file-system.ts`. `pnpm depcruise` и `depcruise:negative` зелёные (перепроверено запуском `pnpm check`, см. ниже codex, я сама повторно `pnpm check` не гоняла — доверяю прогону codex в изолированном клоне и статусу задания «дерево чистое, pnpm check зелёный»). Отдельно отмечено (не находка, а наблюдение): вычисляемый `import(moduleName)` с `moduleName = 'vscode'` проходит dependency-cruiser — известное ограничение статического анализа, не специфичное для этого проекта.
6. **Соответствие плану**: schema/jsonValidation/VSIX allowlist, mtime helper, поколения, cycle guard, overlapping roots, defaults и строковый target-aware renderer — присутствуют, чисто. Не выполнены: end-to-end `descend` (codex-03), загрузка actions из канонического rules file (codex-06), полный command/process render contract (codex-07), README-ограничение (codex-14).
7. **Ошибки и диагностики**: missing/unreadable root и сломанный `.gitmodules` дают диагностики — чисто в этой части. Найдено: некомпилируемый regex не даёт диагностики при загрузке (codex-02); ошибки `identity` в `filterExisting` поглощаются молча, что связано с механизмом codex-04. Наблюдение без отдельной находки: при наличии structural errors в rules-file независимые domain errors по другим полям того же правила не выводятся одновременно — контракт «валидация возвращает все диагностики, а не первую» в этом стыке неоднозначен; не поднимаю как находку, так как требует явного решения по семантике "все диагностики" (per-rule vs per-file), а не факта дефекта.

Отдельно: сложность модели не показалась мне избыточной для заявленных требований (multi-root, generations, cancellation, three-valued laziness) — переусложнения, которое можно снять без потери инварианта, не нашла; это совпадает с наблюдением codex.

## refuted

codex-R01 | Fake FS в `tree.test.ts` — набор canned answers, а не независимая модель | Отклонено codex: ответы выводятся из самостоятельной модели дерева; неверный путь walker приводит к `notFound`, а не к заранее подготовленному ответу
codex-R02 | POSIX single-quote escaping допускает injection | Отклонено codex: close-escape-reopen (`'\''`) реализован корректно; намеренная поломка красит тест
codex-R03 | PowerShell single-quote escaping не защищает backtick или `$()` | Отклонено codex: внутри single quotes оба литеральны в PowerShell, экранируется только апостроф удвоением
codex-R04 | Трёхзначная логика `not` расходится с classifier | Отклонено codex: обе реализации задают `not(of[])` как AND отрицаний, включая `unknown`
codex-R05 | FIFO limiter превышает заданную concurrency | Отклонено codex: счётчик `active` ограничивает одновременно выполняемые callback; реальная проблема — в отмене очереди (см. codex-04), а не в превышении лимита
codex-R06 | Лексические `../`, Unix absolute и Windows drive absolute проходят `descend` | Отклонено codex: эти формы отвергаются `resolveSegments`; подтверждённый обход относится только к физическому symlink-target (codex-05)
codex-R07 | Barrel `index.test.ts` во всех подпредметах вообще ничего не проверяют | Отклонено codex: runtime-экспорты действительно защищены mutation-пробой; type-only exports проверяются совместно с `typecheck`, хотя такие тесты искусственно поддерживают будущую публичную поверхность ради `knip`, а не защищают конкретное поведение
