Краткий вердикт: архитектурное направление в целом здравое, но план пока не готов к реализации. CRITICAL-проблем нет, однако есть 7 HIGH-находок: план ошибочно отказывается от поддерживаемого bold, некорректно описывает двойное размещение view, теряет идентичность корня, не подключает runtime-l10n, обещает неработающую JSON Schema и publish-gate, а terminal actions допускают shell injection.

### codex-01

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: architecture
- **title**: Жирная метка TreeItem уже поддерживается стабильным API
- **mechanism**: План заменяет дословно запрошенный bold цветом и бейджем, исходя из утверждения, что `TreeItem.label` поддерживает только plain text. Начиная с VS Code 1.106 стабильный API принимает `MarkdownString` и умеет отображать всю метку жирным.
- **trigger**: воспроизводится в нормальной работе — пользователь не получит запрошенный bold, хотя актуальный VS Code его поддерживает
- **in_scope**: да
- **anchor**: 00-overview.md, «Ограничения платформы», п.1; 03-tree-view.md, пакет 03-B
- **evidence**: Официальные [release notes VS Code 1.106](https://code.visualstudio.com/updates/v1_106#_markdownstring-support-in-treeitem-labels) объявляют поддержку `MarkdownString` в `TreeItem` labels и показывают комбинацию `**...**`, отрисованную жирным.
- **verification**: confirmed
- **verification_note**: Категорическое ограничение плана устарело. Цена использования — `engines.vscode >= 1.106`; совместимость соответствующей версии Cursor нужно проверить отдельно.
- **fix_direction**: Сделать bold основным способом выделения. Если минимальная версия VS Code/Cursor не позволяет — зафиксировать осознанный fallback на decoration, а не называть bold невозможным.

### codex-02

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: architecture
- **title**: Один view нельзя дважды объявить в разных контейнерах
- **mechanism**: План предлагает объявить один view в собственном контейнере и Explorer. Если использовать один id, второй descriptor будет отвергнут; VS Code требует глобально уникальные view id.
- **trigger**: воспроизводится в нормальной работе — один из режимов `projectsTree.location` не зарегистрируется при буквальной реализации плана
- **in_scope**: да
- **anchor**: 00-overview.md, «Ограничения платформы», п.3; 03-tree-view.md, пакет 03-D
- **evidence**: В [исходнике регистрации views](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts#L2474-L2534) VS Code выдаёт ошибку `Cannot register multiple views with same id`. Само использование `config.<key>` в `when` [официально поддерживается](https://code.visualstudio.com/api/references/when-clause-contexts#check-a-setting-in-a-when-clause).
- **verification**: confirmed
- **verification_note**: Схема работоспособна только с двумя разными view id, двумя регистрациями provider и отдельной привязкой welcome/menu/context contributions.
- **fix_direction**: Явно спроектировать два уникальных view id с общим источником данных либо оставить один view и полагаться на штатное ручное перемещение пользователем.

### codex-03

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: architecture
- **title**: ClassifiedNode теряет идентичность корня
- **mechanism**: `NodeFacts` содержит absolute path и depth, но не `rootId`, `rootPath` или relative path. При этом `pathMatches` работает относительно корня, `${rootPath}` должен разрешаться только из `ClassifiedNode`, а Hide должен скрывать один конкретный узел. Для вложенных или пересекающихся roots восстановить исходный корень однозначно нельзя.
- **trigger**: воспроизводится в нормальной работе — два roots с одинаковой структурой делают `${rootPath}` и exact-hide неоднозначными
- **in_scope**: да
- **anchor**: контракт `NodeFacts`/`ClassifiedNode` в 02-core.md; `${rootPath}` в пакете 02-E; Hide в пакете 04-D
- **evidence**: Показанный контракт `substitute(template, node)` не получает root отдельно; одновременно план обещает multi-root, root-relative matching и `${rootPath}`.
- **verification**: confirmed
- **verification_note**: Absolute path недостаточен: один физический каталог может быть достигнут через разные настроенные или вложенные roots.
- **fix_direction**: Включить принадлежность корню и нормализованный relative path в идентичность узла; определить дедупликацию вложенных roots и семантику Hide.

### codex-04

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Отдельный rules.schema.json не валидирует VS Code setting
- **mechanism**: Первый релиз полагается на отдельную JSON Schema для `projectsTree.rules`. Однако schema внутри `contributes.configuration` должна быть самодостаточной: внешние `$ref` и `definition` там не поддерживаются. План не содержит генерации встроенной схемы в manifest.
- **trigger**: воспроизводится в нормальной работе — до появления webview пользователь редактирует правила вручную и не получает обещанные autocomplete и diagnostics
- **in_scope**: да
- **anchor**: 02-core.md, пакет 02-B; 00-overview.md, первый релиз после этапа 05
- **evidence**: Документация [`contributes.configuration`](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration) прямо требует self-contained schema и перечисляет `$ref` и `definition` как неподдерживаемые.
- **verification**: confirmed
- **verification_note**: Отдельный файл можно оставить каноническим источником, но опубликованный manifest должен получить развёрнутую схему.
- **fix_direction**: Добавить детерминированную генерацию self-contained configuration schema и проверять итоговый упакованный `package.json`.

### codex-05

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Runtime-l10n и локализация webview не подключены
- **mechanism**: Для `vscode.l10n.t()` недостаточно положить `bundle.l10n*.json`: manifest должен содержать поле `l10n`. В пакете 03-E изменение manifest не предусмотрено. Позже webview обещано локализовать «тем же бандлом», хотя webview не имеет `vscode.l10n`, а протокол 06-B не передаёт локаль или словарь.
- **trigger**: воспроизводится в нормальной работе — статические contributions станут русскими, но runtime-строки и webview останутся английскими
- **in_scope**: да
- **anchor**: 03-tree-view.md, пакет 03-E; 06-rules-editor.md, пакет 06-D; требование 11
- **evidence**: [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api#l10n) требует поле `l10n` в manifest; официальный [vscode-l10n](https://github.com/microsoft/vscode-l10n) показывает `"l10n": "./l10n"` и отделяет `package.nls.*` для статических contributions от runtime bundles.
- **verification**: confirmed
- **verification_note**: Выбор `package.nls.*` + `vscode.l10n` правильный, но обязательные связки отсутствуют.
- **fix_direction**: Добавить manifest `l10n` и отдельный контракт передачи локализованных строк в webview; проверять обе поверхности из установленного VSIX.

### codex-06

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: security
- **title**: Подстановка пути в terminal action допускает shell injection
- **mechanism**: `${path}`, `${name}` и `${workspaceFile}` происходят из сканируемой файловой системы и вставляются в строку, переданную `Terminal.sendText`. Она выполняется пользовательским shell. Универсального экранирования для zsh/bash/fish/PowerShell/cmd нет; кавычка, перевод строки, `$()` или разделитель команд в имени каталога способны изменить команду.
- **trigger**: воспроизводится в нормальной работе — пользователь запускает terminal action на специально названном клонированном каталоге
- **in_scope**: да
- **anchor**: 02-core.md, пакет 02-E; 04-actions.md, пакеты 04-A/04-B
- **evidence**: Документация [`Terminal.sendText`](https://code.visualstudio.com/api/references/vscode-api#Terminal.sendText) говорит, что текст передаётся в stdin underlying shell и по умолчанию исполняется. `scope: machine` защищает action definition, но не подставляемые filesystem facts.
- **verification**: confirmed
- **verification_note**: Workspace Trust текущего окна не устанавливает доверие ко всем каталогам, которые расширение сканирует вне workspace.
- **fix_direction**: Для OpenCode передавать проект через отдельный `cwd`, не через shell interpolation. Остальные шаблоны требуют shell-specific модели, подтверждения итоговой команды и тестов по поддерживаемым shell.

### codex-07

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Publish jobs нельзя отключить прямым if по secrets
- **mechanism**: План предлагает `if:` по наличию `VSCE_PAT` и `OVSX_PAT`. GitHub Actions запрещает прямое использование `secrets` в `if`, поэтому workflow не реализует обещанный skip и не включится простым добавлением секретов.
- **trigger**: воспроизводится в штатном CI — при разборе workflow либо первой попытке публикации
- **in_scope**: да
- **anchor**: 01-monorepo-and-tooling.md, пакет 01-E
- **evidence**: [GitHub Actions documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#using-secrets-in-a-workflow) прямо говорит, что secrets нельзя ссылать непосредственно в `if`.
- **verification**: confirmed
- **verification_note**: Документированный вариант — перенести secret в job-level environment и проверять env на уровне step либо использовать отдельный несекретный gate.
- **fix_direction**: Спроектировать поддерживаемый gate и отдельно проверить состояния «секретов нет» и «секреты заданы».

### codex-08

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: judgement
- **domain**: architecture
- **title**: First-match связывает независимые характеристики узла
- **mechanism**: `project`, видимость, highlight, tags и primary action — независимые оси, но первое совпавшее правило обязано выдать весь Verdict. Общее правило «папка с `.git` — проект» подавляет отдельное правило «первый уровень выделять». Каждое пересечение приходится вручную раскладывать в комбинаторный набор правил.
- **trigger**: воспроизводится в нормальной работе — важный проект совпадает с project- и highlight-критериями, но получает только первый verdict
- **in_scope**: да
- **anchor**: модель Rule/Verdict в 00-overview.md и 02-core.md; требование 4
- **evidence**: Требование 4 перечисляет «проект / выделять / считать ли узлом» как характеристики, определяемые критериями по данным; first-match разрешает их композицию только внутри заранее продублированного правила.
- **verification**: unverifiable
- **verification_note**: Любое конечное пересечение формально можно выразить дополнительными правилами, поэтому это дефект выразительности и UX, а не математическая невозможность.
- **fix_direction**: Разделить как минимум discovery/visibility, project detection и presentation policies либо явно принять DNF-подобную модель и проверить её на таблице пересекающихся кейсов.

### codex-09

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Приоритет правил не решает кейс вложенного сабмодуля
- **mechanism**: Правило hidden-repository действительно выигрывает у hidden-skip, только если walker дошёл до папки. Если это настоящий сабмодуль внутри найденного проекта, обход уже остановлен на родительской `.git`-папке.
- **trigger**: воспроизводится в нормальной работе — репозиторий содержит вложенный сабмодуль, а родитель классифицирован как project + stopDescend
- **in_scope**: да
- **anchor**: 00-overview.md, объяснение кейса скрытого проекта; требования 2 и 5
- **evidence**: План одновременно утверждает, что обнаруженный проект является листом обхода, и что порядок правил решает кейс сабмодуля. Порядок не влияет на недостигнутого потомка.
- **verification**: confirmed
- **verification_note**: Если под «сабмодулем» имелась в виду просто dot-prefixed repository непосредственно под scan root, дефекта нет; термин нужно уточнить.
- **fix_direction**: Зафиксировать ожидаемую структуру. Если нужны настоящие вложенные submodules — определить исключение из stop policy и источник их обнаружения.

### codex-10

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: HighlightSpec нарушает порядок этапов или границу core/editor
- **mechanism**: `Verdict` этапа 02 уже зависит от `HighlightSpec`, но сам интерфейс и файл `editor/decorations/highlight.ts` вводятся только на этапе 03. Этап 02 либо не скомпилируется, либо core будет импортировать editor, нарушая главную границу.
- **trigger**: воспроизводится при последовательной реализации — `pnpm check` после этапа 02 не сможет разрешить тип
- **in_scope**: да
- **anchor**: карта этапов; `Verdict.highlight` в 00-overview.md; пакет 03-B
- **evidence**: Этап 02 зависит только от 01 и должен завершаться зелёным typecheck; файл с объявленным `HighlightSpec` относится к следующему этапу и adapter namespace.
- **verification**: confirmed
- **verification_note**: Проблема устраняется переносом нейтрального display-policy контракта в core, но этого решения в плане сейчас нет.
- **fix_direction**: Явно назначить владельца neutral highlight intent в этапе 02, а в editor оставить только преобразование intent в VS Code API.

### codex-11

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: FileSystemReader недостаточен для заявленной symlink/inode policy
- **mechanism**: Порт предоставляет только `readDirectory` и `statMtime`, но walker должен определять symlink и помнить visited inode. Mtime не содержит тип, inode/device или canonical path.
- **trigger**: воспроизводится при реализации symlink policy — walker будет вынужден обойти порт через `node:fs` либо отказаться от заявленного поведения
- **in_scope**: да
- **anchor**: 02-core.md, пакет 02-C, контракт `FileSystemReader`
- **evidence**: Показанная сигнатура не возвращает требуемые метаданные, хотя cyclic-symlink test включён в DoD.
- **verification**: confirmed
- **verification_note**: Если symlink никогда не разыменовываются, visited-inode set избыточен; распознавание самого symlink всё равно должно быть выразимо портом.
- **fix_direction**: Упростить policy до «не follow» либо добавить минимальную `lstat`/identity-операцию в порт.

### codex-12

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: judgement
- **domain**: performance
- **title**: Фоновые обходы не имеют отмены и защиты от устаревших результатов
- **mechanism**: Lazy expand, startup revalidation, полный QuickPick scan, refresh и смена rules/roots могут выполняться одновременно. В контрактах нет cancellation token, config revision и правила atomic publish. Старый scan способен завершиться последним и заменить новое дерево или cache.
- **trigger**: воспроизводится в нормальной работе — пользователь открывает QuickPick или меняет rules во время фонового обхода сотен проектов
- **in_scope**: да
- **anchor**: взаимодействие 02-C/02-D, 03-A/03-D и 06-B
- **evidence**: `walk`/`expand` не принимают cancellation; несколько независимых фоновых операций описаны, но их lifecycle и порядок принятия результата отсутствуют.
- **verification**: unverifiable
- **verification_note**: Конкретная гонка зависит от реализации, но необходимый invariant планом не задан.
- **fix_direction**: Добавить cancellation, scan generation/config revision, single-flight или явную конкурентность, atomic cache publication и тест старого/нового поколения.

### codex-13

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Отрицательный favicon cache не инвалидируется по mtime проекта
- **mechanism**: Добавление `project/public/favicon.ico` меняет mtime `public`, но не обязано менять mtime `project`. Сохранённый отрицательный результат поэтому может пережить фоновую перепроверку.
- **trigger**: воспроизводится в нормальной работе — favicon добавлен во вложенный web root после первого сканирования
- **in_scope**: да
- **anchor**: 02-core.md, пакет 02-D; 03-tree-view.md, пакет 03-C
- **evidence**: План сочетает project-directory mtime, поиск до глубины 10 и отрицательное кэширование без TTL, watcher или dependency stamps вложенных каталогов.
- **verification**: confirmed
- **verification_note**: Та же проблема возникает при изменении `favicon.webRoots`/`favicon.maxDepth`, которые не включены в описанный cache key.
- **fix_direction**: Отделить favicon cache от discovery cache и определить TTL, refresh-policy или stamps просмотренных web roots.

### codex-14

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: tests
- **title**: pnpm check не содержит обещанной проверки Prettier
- **mechanism**: `check` перечислен как `typecheck → lint → depcruise → knip → test`. Prettier только настроен, а конфликтующие ESLint rules выключены, поэтому неформатированный Markdown/JSON/YAML не обязан уронить gate.
- **trigger**: воспроизводится в нормальной работе — агент добавляет неформатированный manifest, workflow или план, а CI остаётся зелёным
- **in_scope**: да
- **anchor**: 01-monorepo-and-tooling.md, пакет 01-B и тестовый план этапа
- **evidence**: Список команд `check` не включает `prettier --check`, хотя тот же раздел обещает падение на неотформатированном файле.
- **verification**: confirmed
- **verification_note**: Typed/stylistic ESLint не покрывает все форматы Prettier.
- **fix_direction**: Включить format-check в полный gate; архитектурные запреты также проверять постоянными fixtures/tests, а не только одноразовой ручной мутацией.

### codex-15

- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: reliability
- **title**: FileDecoration.propagate описан в обратном направлении
- **mechanism**: План объясняет `propagate: false` тем, что содержимое выделенного корня не должно окрашиваться. API распространяет decoration вверх к родителям, а не вниз к детям.
- **trigger**: воспроизводится как неверная модель API; выбранное значение `false` обычно всё равно даст желаемый результат
- **in_scope**: да
- **anchor**: 03-tree-view.md, пакет 03-B
- **evidence**: [`FileDecoration.propagate`](https://code.visualstudio.com/api/references/vscode-api#FileDecoration.propagate) определён как propagation «to its parents»; provider отдельно описывает propagation from descendant upwards.
- **verification**: confirmed
- **verification_note**: Это не ломает основной сценарий, но опасно для будущей логики aggregate decorations.
- **fix_direction**: Исправить описание и отдельно решить, нужна ли агрегация выделения к родительским узлам.

## Coverage

### 1. Факты VS Code API

| Утверждение | Вердикт | Основание |
|---|---|---|
| Bold в `TreeItem.label` невозможен | **Опровергнуто** | Стабильная поддержка `MarkdownString` с VS Code 1.106: [release notes](https://code.visualstudio.com/updates/v1_106#_markdownstring-support-in-treeitem-labels) |
| Для FileDecoration на custom TreeItem нужен URI | **Подтверждено** | Provider вызывается для URI ресурса: [API](https://code.visualstudio.com/api/references/vscode-api#FileDecorationProvider) |
| `badge` ограничен двумя символами | **Не удалось подтвердить как публичный контракт** | Стабильный API говорит только `very short string`; число 2 не стоит фиксировать как гарантированную API-семантику |
| `color` окрашивает label/badge | **Подтверждено для текущей реализации** | File decoration color применяется к тексту и badge; отдельный badge-only color не предоставлен |
| `propagate` распространяет к детям | **Опровергнуто** | Распространяет к родителям, codex-15 |
| Меню нельзя динамически наполнить из settings | **Подтверждено** | `contributes.menus` — статический manifest contribution; QuickPick workaround корректен |
| `when: config.<key>` работает для views | **Подтверждено** | [When-clause reference](https://code.visualstudio.com/api/references/when-clause-contexts#check-a-setting-in-a-when-clause); проблема только в повторном view id |
| `@vscode/webview-ui-toolkit` deprecated/archived | **Подтверждено** | [Официальное объявление](https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561); архивирован 6 января 2025, не 1 января |
| `package.nls.*` + `vscode.l10n` | **Частично подтверждено** | Механика верна, но runtime требует manifest `l10n`, codex-05 |
| `scope: machine` блокирует workspace override | **Подтверждено** | [Configuration scopes](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration): только user/remote settings, без sync |
| Walkthrough auto-open и completion events | **Подтверждено с оговоркой** | [Walkthroughs](https://code.visualstudio.com/api/references/contribution-points#contributes.walkthroughs) поддерживают `onSettingChanged`/`onContext`; выполненный шаг остаётся выполненным даже после обратного изменения настройки |
| `vscode.openFolder(uri, options)` | **Подтверждено** | [Built-in commands](https://code.visualstudio.com/api/references/commands): поддерживаются `forceNewWindow` и `forceReuseWindow`; object options валидны |

### 2–7. Остальные приоритеты

- **Модель правил**: обнаружены coupling first-match, неясная композиция visibility/project/highlight и нерешённый кейс настоящего вложенного submodule. Hidden repository на достигнутом уровне модель выражает.
- **Декомпозиция**: core/editor — хорошая основа; порт ФС правильно принадлежит потребителю. Не хватает root identity и согласованного владельца `HighlightSpec`.
- **14 требований**: все пункты упомянуты. Пункты 3, 4, 5, 10 и 11 реализуются с дефектами, описанными выше. Редактор правил честно отложен во второй релиз, а не пропущен.
- **Безопасность**: machine scope, Trust check, process argv без shell, CSP/nonce и валидация webview-сообщений признаны правильными. Незакрытая дыра — terminal interpolation.
- **Производительность**: I/O pool и lazy traversal разумны. Не хватает cancellation/generation contract; favicon cache некорректно инвалидируется. `expand`, читающий всех детей на уровень вперёд, допустим только после измерения на реальном `~/PhpstormProjects`.
- **Тулинг**: strict TypeScript, ESLint, dependency-cruiser, knip, Vitest, commitlint, VSIX inspection и extension-host tests — хороший baseline. Помимо codex-14, нужны постоянные architecture fixtures и хотя бы Windows CI для path/shell/case-semantics; Linux-only CI не проверяет наиболее рискованные платформенные ветки.
- **Переусложнение первого релиза**: стоит отложить favicon, автоматическое сканирование `$HOME`, persistent cache и action kinds `process`/`uri`/`command`. Для первого релиза достаточно manual roots, `.git`/`.idea`, дерево, rules composition, bold/fallback, `openFolder`, безопасного terminal-with-cwd, en/ru и упаковки. Визуальный редактор правил выбрасывать нельзя — это явное требование 7, но его можно начать с нативных QuickPick/InputBox вместо двухпанельного Lit-webview.

## Refuted

codex-16 | `scope: machine` всё равно читается из `.vscode/settings.json` | официальная документация подтверждает только user/remote levels  
codex-17 | `config.<key>` нельзя использовать в `when` для view | поддерживается; дефект схемы связан с уникальностью view id  
codex-18 | Walkthrough не открывается после установки | официальный contribution point предусматривает auto-open  
codex-19 | `vscode.openFolder` не принимает object options | текущий command contract принимает object с `forceNewWindow` и `forceReuseWindow`  
codex-20 | Динамическая регистрация команды создаёт динамический пункт меню | `registerCommand` не создаёт menu contribution; QuickPick выбран правильно
