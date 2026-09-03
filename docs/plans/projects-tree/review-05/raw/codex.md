Сводный вердикт: **14 подтверждённых находок — 5 HIGH, 7 MEDIUM, 2 LOW**. Главные проблемы: небезопасная модель `%` для интерактивного `cmd.exe`, некомпилируемые regex проходят загрузчик, `submodules` не подключён к основному обходу, отмена не останавливает уже поставленные чтения, физический выход через symlink не проверяется.

Исходный checkout не изменён. Mutation-тесты выполнялись в одноразовом клоне `/tmp`, после проверки клон удалён. В исходном дереве остался только существовавший до ревью `?? docs/plans/projects-tree/review-05/`.

### codex-01

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: security
- **title**: Квотирование `%` для интерактивного `cmd.exe` использует правило batch-файлов
- **mechanism**: `quoteForCmd` удваивает `%`, считая `%%` литеральным процентом и в batch, и в интерактивном терминале. Но отправляемая через `Terminal.sendText` строка выполняется интерактивным `cmd.exe`; внутри `%%NAME%%` остаётся подстрока `%NAME%`, доступная для expansion. Тестовый `unquote` сам превращает `%%` обратно в `%`, поэтому подтверждает собственную модель реализации, а не поведение интерпретатора.
- **trigger**: воспроизводится в нормальной работе на Windows — путь содержит `%NAME%`, действие использует shell `cmd`
- **in_scope**: да
- **anchor**: `quoteForCmd`, cmd-ветка `unquote`
- **evidence**:
  - `packages/projects-tree/src/projects/actions/quoting.ts:52-57`
    ```ts
    * but **not** `%` — percent-expansion of `%VAR%` happens even inside a quoted region.
    * mitigated the standard way: doubling every `%` (`%%`) is recognized unconditionally as an escaped
    * literal percent, in both batch and interactive parsing
    ```
  - `packages/projects-tree/src/projects/actions/quoting.test.ts:28-32`
    ```ts
    case 'cmd': {
      expect(quoted.startsWith('"')).toBe(true);
      expect(quoted.endsWith('"')).toBe(true);
      return quoted.slice(1, -1).replaceAll('%%', '%');
    }
    ```
  - Microsoft документирует `%VariableName%` как подстановку самого `cmd`; отдельные правила для одиночного `%` в prompt и `%%` в batch видны в документации `for`. [cmd — Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd), [for — Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/for).
- **verification**: confirmed
- **verification_note**: код и ложный oracle подтверждены чтением; доступного Windows/cmd для live-run не было. Дополнительная осторожность оправдана тем же классом Windows quoting-ошибок, который привёл к CVE-2024-27980. [Node.js security release](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V21.md)
- **fix_direction**: не применять batch-escape к интерактивному cmd; определить и проверить на Windows безопасную политику для `%` и `!`, вплоть до отказа от таких значений

### codex-02

- **reviewer**: codex
- **severity**: HIGH
- **kind**: point
- **domain**: reliability
- **title**: Файл правил с некомпилируемым regex загружается без диагностик
- **mechanism**: схема разрешает произвольные `pattern` и `flags`, а доменная валидация проверяет только сложность. `loadRulesFile` принимает `pattern: "["`; позже `createClassifier` вызывает `new RegExp` и бросает исключение вместо диагностики файла.
- **trigger**: воспроизводится в нормальной работе — достаточно опечатки в пользовательском pattern или flags
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
- **verification_note**: probe-тест в изолированном клоне ожидал отказ загрузчика для `"["`, но получил `file` и `diagnostics: []`; `compileCondition` затем действительно бросает
- **fix_direction**: при загрузке пробовать компилировать каждый pattern вместе с flags и превращать исключение в адресную диагностику

### codex-03

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: reliability
- **title**: Стратегия `submodules` не работает end-to-end
- **mechanism**: основной entry point принимает корни без `descend` и вызывает только `walkRoot`; production-вызовов `childrenOfProject` нет. Даже при ручном вызове конечный сабмодуль классифицируется с `entries: []`, поэтому `DEFAULT_RULES` не видят его `.git` и возвращают `project:false`.
- **trigger**: воспроизводится в нормальной работе для корня с ожидаемой стратегией `submodules`
- **in_scope**: да
- **anchor**: `DiscoveryRoot`, `discoverProjectTree`, `trieToChildren`
- **evidence**:
  - `packages/projects-tree/src/projects/discovery/tree.ts:21-24`
    ```ts
    export interface DiscoveryRoot {
      readonly id: string;
      readonly path: string;
    }
    ```
  - `packages/projects-tree/src/projects/discovery/descend.ts:216-224`
    ```ts
    const facts: NodeFacts = {
      rootId: parent.rootId,
      absolutePath: joinPath(parent.absolutePath, segment),
      pathFromRoot: parent.pathFromRoot === '' ? segment : `${parent.pathFromRoot}/${segment}`,
    ```
    В том же объекте задано `entries: []`, затем вызывается classifier.
- **verification**: confirmed
- **verification_note**: поиск вызовов показал `childrenOfProject` только в тестах; отдельный probe с `DEFAULT_RULES` получил для объявленного и существующего сабмодуля `project.value === false`
- **fix_direction**: включить `descend` в корневой контракт и единый обход; конечный trie-node должен получать достоверный признак сабмодуля, позволяющий классифицировать его проектом без чтения всего каталога

### codex-04

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: reliability
- **title**: Отмена не останавливает поставленные в очередь filesystem-операции
- **mechanism**: walker проверяет сигнал до входа в limiter, но не после получения слота. В `descend` все `identity()` запускаются одним `Promise.all` без лимитера и промежуточной проверки сигнала. После отмены широкий каталог или большой `.gitmodules` продолжает запускать чтения.
- **trigger**: воспроизводится в нормальной работе — широкий каталог или много сабмодулей, отмена во время обхода
- **in_scope**: да
- **anchor**: `readDirectoryTracked`, `filterExisting`
- **evidence**:
  - `packages/projects-tree/src/projects/discovery/walker.ts:149-153`
    ```ts
    signal.throwIfCancelled();
    try {
      return await runLimited(() => fs.readDirectory(path));
    ```
  - `packages/projects-tree/src/projects/discovery/descend.ts:152-156`
    ```ts
    const checked = await Promise.all(
      entries.map(async (entry) => {
        try {
          await fs.identity(joinPath(projectPath, entry.path));
    ```
- **verification**: confirmed
- **verification_note**: probe с 20 сабмодулями отменял сигнал в первом `identity`; были запущены все 20. Независимый широкий probe walker с concurrency=1 также дочитал все заранее поставленные пути
- **fix_direction**: проверять сигнал внутри callback после получения слота; пропускать `identity` через общий лимитер и прекращать постановку новых операций после отмены

### codex-05

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: security
- **title**: Лексическая проверка `.gitmodules` не предотвращает выход через symlink
- **mechanism**: `resolveSegments` запрещает абсолютные пути и выходящие `..`, но не проверяет физический target. `identity()` следует symlink и возвращает только inode. Путь `link`, являющийся symlink/junction наружу, принимается как находящийся внутри проекта; последующие чтения `.gitmodules` и действия работают с внешним каталогом.
- **trigger**: воспроизводится на рукотворном checkout с `.gitmodules` и symlink/junction в объявленной точке
- **in_scope**: да
- **anchor**: `resolveSegments`, `filterExisting`, `FileSystemReader.identity`
- **evidence**:
  - `packages/projects-tree/src/projects/discovery/descend.ts:153-157`
    ```ts
    try {
      await fs.identity(joinPath(projectPath, entry.path));
      return entry;
    } catch {
    ```
  - `packages/projects-tree/src/projects/discovery/file-system.ts:23-27` задаёт, что `identity` следует symlink, но canonical path не возвращает.
- **verification**: confirmed
- **verification_note**: по текущему контракту порта физическую принадлежность target проекту проверить невозможно; существующие тесты покрывают только лексический `../`
- **fix_direction**: получать canonical path цели и проверять его принадлежность canonical root; отдельно учесть Windows junction, UNC и reparse points

### codex-06

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Канонический файл правил не содержит действий
- **mechanism**: план помещает правила и действия в один `projects-tree.rules.json`, а `primaryAction` ссылается на `ActionDefinition.id`. `RawRulesFile` и схема содержат только `version/rules`; `knownActionIds` должен прийти извне, но загрузить определения пользовательских действий из канонического файла невозможно.
- **trigger**: воспроизводится в нормальной работе при попытке добавить пользовательское действие
- **in_scope**: да
- **anchor**: контракт хранения `projects-tree.rules.json` в `00-overview.md` и пакеты 02-B/02-F
- **evidence**:
  - `packages/projects-tree/src/projects/classification/rules-file.ts:43-46`
    ```ts
    export interface RawRulesFile {
      version: number;
      rules: readonly RawRule[];
    }
    ```
  - `rules.schema.json` запрещает дополнительные top-level свойства и разрешает только `version` и `rules`.
- **verification**: confirmed
- **verification_note**: добавление `actions` текущая схема отвергает из-за `additionalProperties: false`
- **fix_direction**: определить on-disk модель действий, их валидацию и уникальность id; выводить `knownActionIds` из того же загруженного файла

### codex-07

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: security
- **title**: Render-контракт не охватывает аргументы `command` и `process`
- **mechanism**: план требует, чтобы ни один путь подстановки, включая аргументы `command`, не обходил target-aware защиту. Модель объявляет `command.args` как `unknown[]`, не задаёт семантику вложенных шаблонов и предоставляет только renderer одной строки. Для `process` прямо сказано, что command/args не являются шаблонами.
- **trigger**: воспроизводится при action с `${path}` в аргументах command/process
- **in_scope**: да
- **anchor**: контракт 02-F «ни одного пути, где подстановка попадает в sink без обработки»
- **evidence**:
  - `packages/projects-tree/src/projects/actions/action.ts:24-27`
    ```ts
    * `kind: 'openFolder'` and
    * `kind: 'command'` carry no template — nothing here for `render` to touch.
    ```
  - `packages/projects-tree/src/projects/actions/action.ts:65-76` оставляет `process.args` строками, а `command.args` произвольными значениями без render-контракта.
- **verification**: confirmed
- **verification_note**: публичная поверхность actions экспортирует только `render(template: string, ...)`; API безопасного рендера полного `ActionSpec` отсутствует
- **fix_direction**: формально определить допустимые placeholders по каждому виду действия и дать единый API рендера полного spec, включая вложенные command arguments

### codex-08

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: reliability
- **title**: Парсер `.gitmodules` расходится с каноническим `git config`
- **mechanism**: неизвестная escape-последовательность вроде `\q` молча превращается в `q`, хотя git считает файл битым. Обратное расхождение: валидный trailing comment после заголовка секции отвергается строгим regex.
- **trigger**: воспроизводится при ручной правке `.gitmodules`
- **in_scope**: да
- **anchor**: `SECTION_HEADER`, `unescapeChar`, фикстуры `gitmodules.test.ts`
- **evidence**:
  - `packages/projects-tree/src/projects/discovery/gitmodules.ts:32`
    ```ts
    const SECTION_HEADER = /^\[\s*([A-Za-z0-9][A-Za-z0-9-]*)\s*(?:"((?:[^"\\]|\\.)*)")?\s*]$/;
    ```
  - `packages/projects-tree/src/projects/discovery/gitmodules.ts:164-167`
    ```ts
    if (char === 'n') return '\n';
    if (char === 't') return '\t';
    return char;
    ```
- **verification**: confirmed
- **verification_note**: одна и та же фикстура `path = foo\q` была принята `parseGitmodules`, но `git config -f` завершился с `fatal: bad config line 2`; mutation-probe покраснел
- **fix_direction**: строить corpus фикстур от поведения `git config`; отвергать неизвестные escape и поддержать допустимые trailing comments

### codex-09

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Traversal-тест заявляет `stopDescend`, но не устанавливает его
- **mechanism**: тест называется `honoring skip and stopDescend`, однако helper `projectByGitRule` задаёт только `project:true`, а assertions ожидают потомков проекта. Удаление проверки `stopDescend` из walker этот тест не обнаружит.
- **trigger**: недостижим как отдельный runtime-дефект; это ложное покрытие регрессии
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/discovery/tree.test.ts:186-188`
- **evidence**:
  ```ts
  function projectByGitRule(id = 'is-project'): Rule {
    return { id, when: { kind: 'hasChild', names: ['.git'] }, verdict: { project: true } };
  }
  ```
- **verification**: confirmed
- **verification_note**: во traversal-тестах нет правила с `verdict.stopDescend`; ожидаемый список содержит `project-a/.git` и `project-a/src`
- **fix_direction**: добавить traversal-case с `stopDescend:true`, ловушкой под узлом и независимыми assertions на отсутствие чтения и детей

### codex-10

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: performance
- **title**: Решающий name-only `skip` не всегда предотвращает чтение каталога
- **mechanism**: `requiresEntries` независимо анализирует все поля. Даже если `skip:true` уже решён условием по имени и нормализация обнулит остальные поля, более поздний `hasChild` для `project` возвращает `unknown` и заставляет читать каталог.
- **trigger**: воспроизводится в нормальной работе — name-only skip расположен перед hasChild-правилом другого поля
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/discovery/walker.ts:288-305`
- **evidence**:
  ```ts
  function requiresEntries(rules: readonly Rule[], facts: NodeFacts): boolean {
    return VERDICT_FIELDS.some((field) => requiresEntriesForField(rules, field, facts));
  }
  ```
- **verification**: confirmed
- **verification_note**: probe с `skip(node_modules)` перед hasChild-project ожидал только чтение root, но получил `["", "/node_modules"]`
- **fix_direction**: учитывать нормализацию: если `skip` уже безусловно разрешился в true, не вычислять и не читать данные ради полей, которые всё равно будут сброшены

### codex-11

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: security
- **title**: Эвристика regex пропускает классический ReDoS с перекрывающейся альтернативой
- **mechanism**: проверка ищет только вложенные кванторы и backreferences. Паттерн `^(a|aa)+$` не содержит ни того, ни другого, признаётся безопасным, но имеет экспоненциальное число разбиений строки.
- **trigger**: воспроизводится на пользовательском правиле и имени каталога из повторяющихся `a`, заканчивающемся несовпадающим символом
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/classification/regex-safety.ts:24-38`
- **evidence**:
  ```ts
  if (BACKREFERENCE.test(pattern)) {
    return { safe: false, reason: ... };
  }
  if (hasNestedQuantifier(pattern)) {
    return { safe: false, reason: ... };
  }
  ```
- **verification**: confirmed
- **verification_note**: `checkRegexComplexity('^(a|aa)+$')` вернул `{safe:true}`; локальный ограниченный benchmark вырос примерно с 6 ms на 24 символах до 173 ms на 36
- **fix_direction**: расширить проверку на перекрывающиеся альтернативы и последовательные неоднозначные кванторы либо использовать движок с гарантированным ограничением сложности

### codex-12

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: reliability
- **title**: Renderer оставляет часть ошибочных placeholders без диагностики и не отвергает одиночный CR
- **mechanism**: regex распознаёт только `${[A-Za-z]+}`, поэтому `${root_path}`, `${path1}`, `${foo-bar}` и `${}` остаются в результате буквально, минуя `unknownVariable`. Проверка управляющего переноса ищет только `\n`; одиночный `\r`, являющийся terminal control character, проходит в shell target.
- **trigger**: воспроизводится при опечатке в action template или имени POSIX-каталога с `\r`
- **in_scope**: да
- **anchor**: `VARIABLE_PATTERN`, проверка newline в `render`
- **evidence**:
  - `packages/projects-tree/src/projects/actions/render.ts:37`
    ```ts
    const VARIABLE_PATTERN = /\$\{([a-zA-Z]+)\}/g;
    ```
  - `packages/projects-tree/src/projects/actions/render.ts:66-69`
    ```ts
    return template.replaceAll(VARIABLE_PATTERN, (_match, variableName: string) => {
      const value = lookupVariable(variableName, node);
      if (value.includes('\n')) {
    ```
- **verification**: confirmed
- **verification_note**: оба probe-теста покраснели: `${root_path}` вернулся буквально, а shell-значение `safe\rcalc` не вызвало `RenderError`
- **fix_direction**: сначала находить весь placeholder-синтаксис и валидировать имя отдельно; для terminal/shell sinks отвергать как минимум `\r` и `\n`

### codex-13

- **reviewer**: codex
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: Два non-BMP символа badge ошибочно считаются длиннее двух символов
- **mechanism**: схема/Ajv и VS Code считают Unicode code points, а доменная валидация использует UTF-16 `string.length`. Например, `🔥🔥` имеет `length === 4` и отвергается после прохождения схемы.
- **trigger**: воспроизводится в нормальной работе при badge из двух emoji
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/projects/classification/validation.ts:95-100`
- **evidence**:
  ```ts
  if (highlight.badge !== undefined && highlight.badge.length > 2) {
    diagnostics.push({
      path: `${path}/badge`,
  ```
- **verification**: confirmed
- **verification_note**: probe вернул badge-диагностику для `🔥🔥`; `api-facts.md`, факт 7, описывает code-point-aware подсчёт VS Code
- **fix_direction**: считать те же Unicode units, что и VS Code; добавить тесты на один и два emoji и смешанную BMP/non-BMP пару

### codex-14

- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: architecture
- **title**: В README не записано отсутствие Settings Sync для файла правил
- **mechanism**: пакет 02-B требует явно документировать, что `projects-tree.rules.json` в global storage не переносится Settings Sync и должен экспортироваться/импортироваться вручную. Текущий README содержит только описание scaffold и команды разработки.
- **trigger**: воспроизводится при использовании расширения на второй машине
- **in_scope**: да
- **anchor**: DoD/решение пакета 02-B о документировании известного ограничения
- **evidence**: `packages/projects-tree/README.md:1-31` не содержит упоминаний rules file, Settings Sync, export или import
- **verification**: confirmed
- **verification_note**: проверено поиском по README и прямым чтением файла
- **fix_direction**: добавить короткий раздел о machine-local файле правил и предусмотренном export/import

## Coverage

1. **Тесты, которые не тестируют**: fake FS строит независимую модель дерева и не является набором canned answers. Найден ложный `stopDescend` test и отсутствие assertions на project-verdict сабмодуля. Quoting round-trip признан недостаточным именно для cmd. Runtime-экспорты barrel-файлов проверены mutation-тестом: удаление `parseGitmodules` покрасило `discovery/index.test.ts`.

2. **Безопасность**: проверены POSIX, PowerShell и cmd quoting, newline/CR, URI encoding, action sinks, lexical path containment и regex safety. POSIX close-escape-reopen и PowerShell doubling корректны; mutation поломки PowerShell escaping покрасила оригинальный тест. Найдены `%`/cmd, CR, symlink escape, неполный action render contract и ReDoS.

3. **Модель правил**: first-match по полю, `Object.hasOwn`, disabled rules, нормализация, `**`, root/absolute anchors и сброс `lastIndex` признаны корректными. Бессмысленные комбинации значений нормализуются предсказуемо.

4. **Ленивость/производительность**: трёхзначная логика `all`/`any`/`not` совпадает с boolean classifier. FIFO limiter удерживает peak concurrency. Найдены лишнее чтение после решающего skip, queued reads после cancellation и неограниченный `Promise.all(identity)`.

5. **Границы**: текущие production imports идут через barrels; `vscode` в core нет; `node:fs` находится только в `file-system.ts`. `pnpm depcruise` и negative fixtures зелёные. При этом вычисляемый `import(moduleName)`, где `moduleName = 'vscode'`, проходит обе проверки; это ограничение статического анализа и defense-in-depth observation, а не отдельная runtime-находка.

6. **Соответствие плану**: schema/jsonValidation/VSIX allowlist, mtime helper, поколения, cycle guard, overlapping roots, defaults и строковый target-aware renderer присутствуют. Не выполнены end-to-end `descend`, загрузка actions из канонического rules file, command/process render contract и README-ограничение. Сабмодульный ClassifiedNode не получает корректный project-verdict.

7. **Ошибки и диагностики**: missing/unreadable root и сломанный `.gitmodules` дают диагностики. Ошибки `identity` в `filterExisting` сейчас поглощаются как «не инициализирован»; это включено в механизм `codex-04`. Структурные и доменные диагностики возвращаются отдельными фазами: при наличии structural errors независимые domain errors не показываются до следующей загрузки — контракт «все диагностики» здесь неоднозначен, поэтому отдельной находкой не поднято.

Полная базовая валидация в чистом клоне прошла: `pnpm check`, 19 файлов тестов, 238 тестов. После mutation-проверок исходный checkout повторно проверен: файлов материала ревью в рабочем diff нет.

## refuted

codex-R01 | Fake FS в `tree.test.ts` является набором canned answers | Отклонено: ответы выводятся из самостоятельной модели дерева; неверный путь walker приводит к `notFound`

codex-R02 | POSIX single-quote escaping допускает injection | Отклонено: close-escape-reopen реализован корректно; намеренная поломка покрасила тест

codex-R03 | PowerShell single-quote escaping не защищает backtick или `$()` | Отклонено: внутри single quotes они литеральны, апостроф удваивается

codex-R04 | Трёхзначная логика `not` расходится с classifier | Отклонено: обе реализации задают `not(of[])` как AND отрицаний, включая `unknown`

codex-R05 | FIFO limiter превышает заданную concurrency | Отклонено: счётчик `active` ограничивает одновременно выполняемые callback; проблема относится к отмене очереди, а не к превышению лимита

codex-R06 | Лексические `../`, Unix absolute и Windows drive absolute проходят `descend` | Отклонено: эти формы отвергаются; подтверждённый обход относится к физическому symlink-target

codex-R07 | Barrel `index.test.ts` полностью ничего не проверяют | Отклонено: runtime-экспорты действительно защищены; type-only exports проверяются совместно с `typecheck`, хотя такие тесты искусственно поддерживают будущую публичную поверхность для `knip`
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-boundary-probe.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-boundary-probe.ts
new file mode 100644
index 0000000000000000000000000000000000000000..8068fa8e3a89dda4495cc7bbf73841f2f32a6e68
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-boundary-probe.ts
@@ -0,0 +1,5 @@
+const editorRuntimeModule = 'vscode';
+
+export async function violateCoreBoundary(): Promise<unknown> {
+  return import(editorRuntimeModule);
+}
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-cr-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-cr-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..a6c79d967a8640e638047ce165312bad2551c170
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-cr-probe.test.ts
@@ -0,0 +1,8 @@
+import { expect, it } from 'vitest';
+import { RenderError } from './action';
+import { render } from './render';
+
+it('probe: rejects a lone carriage return in a terminal substitution', () => {
+  const node = { path: '/p', name: 'safe\rcalc', parentPath: '/', rootPath: '/' };
+  expect(() => render('cd ${name}', node, { kind: 'shell', shell: 'bash' })).toThrow(RenderError);
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-render-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-render-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..c7addef34ae13258b4c18ba959550219d037280b
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/actions/review-render-probe.test.ts
@@ -0,0 +1,10 @@
+import { expect, it } from 'vitest';
+import { RenderError } from './action';
+import { render } from './render';
+
+it('probe: placeholder-shaped unknown names are diagnostics', () => {
+  const node = { path: '/p', name: 'p', parentPath: '/', rootPath: '/' };
+  for (const template of ['${root_path}', '${path1}', '${foo-bar}', '${}']) {
+    expect(() => render(template, node, { kind: 'shell', shell: 'bash' })).toThrow(RenderError);
+  }
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/classification/review-all-diagnostics-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/classification/review-all-diagnostics-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..8a2c715929b660beb3feb6acba475fc35bce397d
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/classification/review-all-diagnostics-probe.test.ts
@@ -0,0 +1,13 @@
+import { expect, it } from 'vitest';
+import { loadRulesFile } from './rules-file';
+
+it('probe: returns structural and independent domain diagnostics together', () => {
+  const result = loadRulesFile(JSON.stringify({
+    version: 1,
+    rules: [
+      { id: 'shape', when: { kind: 'nameMatches', pattern: 'x' }, then: { skip: 'yes' } },
+      { id: 'domain', when: { kind: 'nameMatches', pattern: 'x' }, then: { primaryAction: 'missing' } },
+    ],
+  }), []);
+  expect(result.diagnostics.some((d) => d.path === '/rules/1/then/primaryAction')).toBe(true);
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/classification/review-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/classification/review-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..14462e20907715aea83539e2b7fbc1a85e3703c1
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/classification/review-probe.test.ts
@@ -0,0 +1,14 @@
+import { expect, it } from 'vitest';
+import { loadRulesFile } from './rules-file';
+
+it('probe: invalid regex is rejected during rules-file loading', () => {
+  const result = loadRulesFile(
+    JSON.stringify({
+      version: 1,
+      rules: [{ id: 'bad', when: { kind: 'nameMatches', pattern: '[' }, then: { skip: true } }],
+    }),
+    [],
+  );
+  expect(result.file).toBeUndefined();
+  expect(result.diagnostics.length).toBeGreaterThan(0);
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-descend-cancel-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-descend-cancel-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..ff566a388c2cda384f6b91d349bcf406b94789bc
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-descend-cancel-probe.test.ts
@@ -0,0 +1,28 @@
+import { expect, it } from 'vitest';
+import { CancellationSource } from './cancellation.js';
+import type { FileSystemReader } from './file-system.js';
+import { childrenOfProject } from './descend.js';
+import type { ClassifiedNode } from './walker.js';
+
+it('probe: cancellation stops starting submodule identity reads', async () => {
+  const source = new CancellationSource();
+  let identities = 0;
+  const sections = Array.from({ length: 20 }, (_, i) => `[submodule "s${i}"]\npath = s${i}`).join('\n');
+  const fs: FileSystemReader = {
+    async readDirectory() { return []; },
+    async readFile() { return sections; },
+    async identity(path) { identities += 1; if (identities === 1) source.cancel(); return path; },
+  };
+  const node = {
+    facts: { rootId: 'r', absolutePath: '/repo', pathFromRoot: '', name: 'repo', depthFromRoot: 0, entries: [] },
+    verdict: {
+      skip: { value: false, byRule: undefined }, stopDescend: { value: false, byRule: undefined },
+      project: { value: true, byRule: 'parent' }, primaryAction: { value: undefined, byRule: undefined },
+      highlight: { value: undefined, byRule: undefined }, tags: { value: [], byRule: undefined },
+    }, children: [],
+  } satisfies ClassifiedNode;
+  await expect(childrenOfProject(node, 'submodules', {
+    fs, rules: [], signal: source.signal, maxDepth: 4,
+  })).rejects.toThrow('cancelled');
+  expect(identities).toBe(1);
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-diagnostic-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-diagnostic-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..f0024f298999cb9bbc6b439233539c0fc6f90bbe
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-diagnostic-probe.test.ts
@@ -0,0 +1,28 @@
+import { expect, it } from 'vitest';
+import { CancellationSource } from './cancellation.js';
+import { FileSystemError, type FileSystemReader } from './file-system.js';
+import { childrenOfProject } from './descend.js';
+import type { ClassifiedNode } from './walker.js';
+
+it('probe: reports permission errors while checking declared submodule paths', async () => {
+  const fs: FileSystemReader = {
+    async readDirectory() { return []; },
+    async readFile(path) {
+      if (path === '/repo/.gitmodules') return '[submodule "child"]\npath = child';
+      throw new FileSystemError('notFound', 'missing');
+    },
+    async identity() { throw new FileSystemError('permissionDenied', 'denied'); },
+  };
+  const node = {
+    facts: { rootId: 'r', absolutePath: '/repo', pathFromRoot: '', name: 'repo', depthFromRoot: 0, entries: [] },
+    verdict: {
+      skip: { value: false, byRule: undefined }, stopDescend: { value: false, byRule: undefined },
+      project: { value: true, byRule: 'parent' }, primaryAction: { value: undefined, byRule: undefined },
+      highlight: { value: undefined, byRule: undefined }, tags: { value: [], byRule: undefined },
+    }, children: [],
+  } satisfies ClassifiedNode;
+  const result = await childrenOfProject(node, 'submodules', {
+    fs, rules: [], signal: new CancellationSource().signal, maxDepth: 4,
+  });
+  expect(result.diagnostics).not.toEqual([]);
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-gitmodules-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-gitmodules-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..19f9a8a325671192e4e859a8ca02f5d51140f6ac
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-gitmodules-probe.test.ts
@@ -0,0 +1,7 @@
+import { expect, it } from 'vitest';
+import { parseGitmodules } from './gitmodules.js';
+
+it('probe: rejects an escape sequence git-config itself rejects', () => {
+  expect(() => parseGitmodules(String.raw`[submodule "x"]
+path = foo\q`)).toThrow();
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..4711417efb88192cd4d8e1e03e3bce2f8c4e5312
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-probe.test.ts
@@ -0,0 +1,25 @@
+import { expect, it } from 'vitest';
+import type { Rule } from '../classification/index.js';
+import { CancellationSource } from './cancellation.js';
+import type { FileSystemReader } from './file-system.js';
+import { discoverProjectTree } from './tree.js';
+
+it('probe: a decisive name-only skip avoids reading despite later hasChild fields', async () => {
+  const reads: string[] = [];
+  const fs: FileSystemReader = {
+    async readDirectory(path) {
+      reads.push(path);
+      if (path === '') return [{ name: 'node_modules', type: 'dir' }];
+      if (path === '/node_modules') return [{ name: '.git', type: 'dir' }];
+      return [];
+    },
+    async readFile() { return ''; },
+    async identity(path) { return path; },
+  };
+  const rules: Rule[] = [
+    { id: 'skip', when: { kind: 'nameMatches', pattern: '^node_modules$' }, verdict: { skip: true } },
+    { id: 'project', when: { kind: 'hasChild', names: ['.git'] }, verdict: { project: true } },
+  ];
+  await discoverProjectTree([{ id: 'r', path: '' }], rules, fs, new CancellationSource().signal);
+  expect(reads).toEqual(['']);
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-submodule-probe.test.ts b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-submodule-probe.test.ts
new file mode 100644
index 0000000000000000000000000000000000000000..ff740c4f3c49b53b0098d0a9f27e16d0d53bb5e1
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/packages/projects-tree/src/projects/discovery/review-submodule-probe.test.ts
@@ -0,0 +1,29 @@
+import { expect, it } from 'vitest';
+import { DEFAULT_RULES } from '../classification/index.js';
+import { CancellationSource } from './cancellation.js';
+import type { FileSystemReader } from './file-system.js';
+import { childrenOfProject } from './descend.js';
+import type { ClassifiedNode } from './walker.js';
+
+it('probe: a declared initialized submodule is classified as a project by defaults', async () => {
+  const fs: FileSystemReader = {
+    async readDirectory() { throw new Error('must not read directories'); },
+    async readFile(path) {
+      if (path === '/repo/.gitmodules') return '[submodule "child"]\npath = child';
+      throw Object.assign(new Error('missing'), { code: 'notFound' });
+    },
+    async identity(path) { if (path === '/repo/child') return 'id'; throw new Error('missing'); },
+  };
+  const node = {
+    facts: { rootId: 'r', absolutePath: '/repo', pathFromRoot: '', name: 'repo', depthFromRoot: 0, entries: [] },
+    verdict: {
+      skip: { value: false, byRule: undefined }, stopDescend: { value: false, byRule: undefined },
+      project: { value: true, byRule: 'parent' }, primaryAction: { value: undefined, byRule: undefined },
+      highlight: { value: undefined, byRule: undefined }, tags: { value: [], byRule: undefined },
+    }, children: [],
+  } satisfies ClassifiedNode;
+  const result = await childrenOfProject(node, 'submodules', {
+    fs, rules: DEFAULT_RULES, signal: new CancellationSource().signal, maxDepth: 1,
+  });
+  expect(result.children[0]?.verdict.project.value).toBe(true);
+});
diff --git a//tmp/projects-tree-review.XWjeE0/repo/review-invalid.gitconfig b//tmp/projects-tree-review.XWjeE0/repo/review-invalid.gitconfig
new file mode 100644
index 0000000000000000000000000000000000000000..6630b1a16b2e56d05440809ad0d46237d8d6d2d2
--- /dev/null
+++ b//tmp/projects-tree-review.XWjeE0/repo/review-invalid.gitconfig
@@ -0,0 +1,2 @@
+[submodule "x"]
+path = foo\q

