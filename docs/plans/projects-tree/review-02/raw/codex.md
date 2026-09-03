### codex-01

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: architecture
- **title**: First-match повторяет исходный дефект внутри каждой оси
- **mechanism**: Каждая ось всё ещё объединяет независимые свойства. Правило с `project: true` блокирует последующее правило с `primaryAction`; `highlight` блокирует `tags`; `skip` блокирует независимо заданный `stopDescend`. В частности, правило, сохраняющее видимость скрытого репозитория, может не дать примениться сгенерированному `descend: stop`.
- **trigger**: воспроизводится при штатной композиции общих и специализированных правил
- **in_scope**: да
- **anchor**: контракт трёх осей `Verdict`
- **evidence**: [00-overview.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/00-overview.md:76>) и [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:28>) применяют first-match к оси целиком, хотя каждая ось содержит несколько независимо изменяемых полей.
- **verification**: confirmed
- **verification_note**: разделение устранило конфликт между project и highlight, но сохранило тот же механизм внутри трёх групп
- **fix_direction**: определить приоритет на уровне отдельных эффектов либо обосновать неделимость каждой пары полей

### codex-02

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: architecture
- **title**: Межосевые комбинации не имеют потребительской семантики
- **mechanism**: `skip: true` вместе с `project: true` объявлено законным, но не определено, попадает ли такой проект в QuickPick, продолжается ли обход и куда помещаются его дети. Команда Hide меняет только visibility, поэтому скрытый проект может остаться доступным в быстром выборе.
- **trigger**: воспроизводится после Hide либо при правиле, задающем identity и visibility разными приоритетами
- **in_scope**: да
- **anchor**: контракт композиции `visibility × identity × appearance`
- **evidence**: [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:66>) разрешает межосевые сочетания, а [04-actions.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/04-actions.md:93>) не определяет фильтрацию QuickPick по visibility.
- **verification**: confirmed
- **verification_note**: план задаёт вычисление Verdict, но не его нормализацию перед разными потребителями
- **fix_direction**: зафиксировать таблицу итогового поведения для значимых комбинаций осей и единый контракт фильтрации дерева, QuickPick и действий

### codex-03

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: architecture
- **title**: `descend` не выражается объявленным сахаром над правилами
- **mechanism**: Условие `inRoot` не означает «после обнаружения проекта»: правило `stop` либо остановит сам корень, либо потребует отсутствующего условия `isProject`. `submodules` вообще меняет способ перечисления детей на динамический список из `.gitmodules`, чего булевый `stopDescend` выразить не может.
- **trigger**: воспроизводится при любом корне с `descend: stop` или `submodules`
- **in_scope**: да
- **anchor**: контракт `RootConfig.descend -> expandRootSugar -> Rule[]`
- **evidence**: [00-overview.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/00-overview.md:105>) и [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:101>) обещают сведение к visibility-правилу; доступный `Condition` не умеет ссылаться на уже вычисленную project identity.
- **verification**: confirmed
- **verification_note**: ни одно объявленное условие или поле Verdict не выбирает детей по содержимому `.gitmodules`
- **fix_direction**: развести политику остановки и стратегию перечисления либо ввести в модель правил полноценный эффект перехода внутрь проекта

### codex-04

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: architecture
- **title**: Порт ФС не позволяет реализовать `readSubmodulePaths`
- **mechanism**: Разбор `.gitmodules` требует чтения файла, но `FileSystemReader` предоставляет только `readDirectory()` и `identity()`. Прямой `node:fs` одновременно запрещён архитектурным правилом.
- **trigger**: воспроизводится при реализации `descend: submodules`
- **in_scope**: да
- **anchor**: контракт `FileSystemReader`
- **evidence**: `readSubmodulePaths()` объявлен в [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:101>), порт — там же ниже, а запрет Node built-ins задан в [01-monorepo-and-tooling.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/01-monorepo-and-tooling.md:50>).
- **verification**: confirmed
- **verification_note**: ни одна сигнатура порта не возвращает содержимое файла
- **fix_direction**: добавить минимальную возможность ограниченного чтения файла через порт и закрепить обработку ошибок и лимит размера

### codex-05

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: performance
- **title**: Синхронный JavaScript RegExp нельзя остановить по истечении бюджета
- **mechanism**: Катастрофический backtracking блокирует поток внутри вызова RegExp. Проверить elapsed time можно только после возврата, когда extension host уже завис. Изолят, worker или движок с гарантированным временем план не вводит.
- **trigger**: воспроизводится на ошибочной регулярке и подходящем имени каталога
- **in_scope**: да
- **anchor**: контракт «бюджет времени на классификацию узла»
- **evidence**: [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:36>) обещает прерывание синхронного `evaluate()`. Node.js отдельно предупреждает, что уязвимый RegExp блокирует event loop: [Don’t Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop#blocking-the-event-loop-redos).
- **verification**: confirmed
- **verification_note**: внутри синхронного RegExp отсутствует точка проверки таймера или отмены
- **fix_direction**: выбрать реально прерываемую или гарантированно безопасную стратегию и проверять DoD по времени блокировки extension host

### codex-06

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: security
- **title**: Terminal-квотирование опирается на недостоверно определяемый shell
- **mechanism**: `terminal.integrated.defaultProfile.<platform>` содержит имя профиля. Профиль может иметь произвольное имя, executable, `source` и аргументы; из имени и платформы нельзя надёжно вывести грамматику фактического shell.
- **trigger**: воспроизводится со штатным пользовательским профилем вроде `my-pwsh`, Cygwin, WSL или shell-wrapper
- **in_scope**: да
- **anchor**: контракт `quoteForShell(..., ShellKind)` исполнителя terminal
- **evidence**: [04-actions.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/04-actions.md:22>) предлагает такую эвристику. Официально профиль — произвольно именованная комбинация path/source/args: [Terminal Profiles](https://code.visualstudio.com/docs/terminal/profiles).
- **verification**: confirmed
- **verification_note**: VS Code API не обещает обратного отображения имени профиля в shell grammar
- **fix_direction**: отказаться от угадывания грамматики — контролировать запускаемый shell либо использовать форму исполнения с раздельными executable и argv

### codex-07

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: security
- **title**: Контракт квотирует результат целиком, а не отдельные подстановки
- **mechanism**: `substitute(template)` возвращает всю командную строку как `Untrusted<string>`, после чего `quoteForShell()` получает её целиком. Квотирование всей строки превращает `opencode ${path}` в один shell-токен; отсутствие такого квотирования возвращает инъекцию. Контракт не выражает безопасное квотирование только значений placeholders.
- **trigger**: воспроизводится на обычной terminal-команде с аргументом пути
- **in_scope**: да
- **anchor**: контракт `substitute -> quoteForShell`
- **evidence**: сигнатуры находятся в [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:183>), а исполнитель — в [04-actions.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/04-actions.md:22>).
- **verification**: confirmed
- **verification_note**: объявленный тип не сохраняет границы literal-фрагментов и подставленных значений
- **fix_direction**: определить шаблон как структурированную последовательность доверенных литералов и недоверенных значений либо изменить модель terminal action

### codex-08

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: security
- **title**: `Untrusted<T>` не номинален и не закрывает все sinks
- **mechanism**: `{readonly untrusted: T}` — структурный объект, доступный для конструирования и распаковки любому коду. Не определено, как обрабатываются placeholders в `command.args`, `cwd`, `terminalName` и URI-компонентах. Произвольная VS Code command может сама быть terminal/process sink.
- **trigger**: воспроизводится при добавлении подстановки в один из неописанных строковых sink
- **in_scope**: да
- **anchor**: контракт границы доверия `Untrusted<string>`
- **evidence**: модель находится в [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:183>). TypeScript использует структурную совместимость: [Type Compatibility](https://www.typescriptlang.org/docs/handbook/type-compatibility).
- **verification**: confirmed
- **verification_note**: оболочка снижает вероятность случайной ошибки, но не обеспечивает заявленную номинальность и полноту потока данных
- **fix_direction**: составить матрицу `источник × поле × sink × контекст кодирования`; бренд использовать только как дополнительную страховку

### codex-09

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Отмена требуется в первом релизе, но появляется только в этапе 07
- **mechanism**: QuickPick этапа 04 обещает отменяемый полный обход и прекращение чтений ФС. `Walker.expand()` cancellation не принимает; порт отмены вводится только в 07-A.
- **trigger**: воспроизводится при отмене первого Open Project на большом корне
- **in_scope**: да
- **anchor**: контракт отмены обхода первого релиза
- **evidence**: [04-actions.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/04-actions.md:93>) требует отмену; [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:147>) не даёт соответствующего канала; [07-cache-and-reactivity.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/07-cache-and-reactivity.md:11>) впервые вводит порт.
- **verification**: confirmed
- **verification_note**: закрытие UI не может остановить уже начатые операции ядра
- **fix_direction**: перенести минимальный cooperative-cancellation контракт в этап 02/04; поколения можно оставить этапу 07

### codex-10

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Идентичность по пути сталкивается на перекрывающихся корнях
- **mechanism**: Один физический путь может присутствовать под двумя корнями с разными `rootId`, depth и правилами. `NodeRegistry` склеит их в один объект, а `TreeItem.id = path` даст дубликат.
- **trigger**: воспроизводится при корнях `/repos` и `/repos/team`
- **in_scope**: да
- **anchor**: контракт идентичности `NodeRegistry` и `TreeItem.id`
- **evidence**: вложенные корни входят в edge cases [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:170>), но реестр и id ключуются только path в [03-tree-view.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/03-tree-view.md:12>).
- **verification**: confirmed
- **verification_note**: absolute path не является уникальной логической идентичностью при нескольких корнях
- **fix_direction**: определить составной логический ключ и применять его одинаково в registry, TreeItem.id, cache и generations

### codex-11

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Webview-протокол не умеет сохранять действия
- **mechanism**: UI обязан редактировать `ActionDefinition[]`, но `FromWebview` передаёт только `saveRules { rules }`. Невозможно атомарно сохранить действия и проверить ссылки `primaryAction`.
- **trigger**: воспроизводится при попытке добавить или изменить действие в редакторе
- **in_scope**: да
- **anchor**: контракт `FromWebview`
- **evidence**: протокол находится в [06-rules-editor.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/06-rules-editor.md:30>), требование редактора действий — там же ниже.
- **verification**: confirmed
- **verification_note**: ни одно сообщение от webview не содержит изменённые actions
- **fix_direction**: сохранять и валидировать единый атомарный документ правил и действий

### codex-12

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Несколько писателей `rules.json` допускают потерю данных
- **mechanism**: Один файл изменяют текстовый редактор, Hide/Manage Hidden и webview со своим несохранённым снимком. Валидация перед записью не предотвращает lost update, частичную запись или перезапись dirty-документа. Не определены atomic replace, revision/etag, watcher, конфликт, создание отсутствующего файла и восстановление после удаления.
- **trigger**: воспроизводится при ручной правке файла одновременно с Hide или сохранением webview
- **in_scope**: да
- **anchor**: контракт жизненного цикла и записи `rules.json`
- **evidence**: три независимых пути записи описаны в [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:77>), [04-actions.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/04-actions.md:105>) и [06-rules-editor.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/06-rules-editor.md:11>). VS Code отдельно предупреждает, что каталог `globalStorageUri` может не существовать: [ExtensionContext API](https://code.visualstudio.com/api/references/vscode-api#ExtensionContext).
- **verification**: confirmed
- **verification_note**: общего write-path и версии содержимого нет
- **fix_direction**: определить единственного координатора записи, optimistic concurrency, атомарное сохранение и полный lifecycle отсутствующего/изменённого/удалённого файла

### codex-13

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Строка 15 `api-facts.md` ложна
- **mechanism**: `secrets` недоступен не только в `jobs.<id>.if`, но и непосредственно в `steps.if`. Таблица контекстов для `jobs.<job_id>.steps.if` не содержит `secrets`.
- **trigger**: воспроизводится, если исполнитель использует `steps.if: secrets.X != ''`
- **in_scope**: да
- **anchor**: API-факт 15
- **evidence**: утверждение находится в [api-facts.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/api-facts.md:26>); официальный список разрешённых контекстов: [GitHub Actions contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability).
- **verification**: confirmed
- **verification_note**: часть про `jobs.if` верна; часть про прямую доступность в `steps.if` ложна. Выбранный в 01-E мост через output предыдущего шага при этом остаётся рабочим
- **fix_direction**: исправить строку и зафиксировать допустимый мост `secret → env/output → условие шага`

### codex-14

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: `api-facts.md` не выполняет собственный контракт полноты и воспроизводимости
- **mechanism**: Вне таблицы остались решения об `vscode.openFolder`, walkthrough completion events, terminal API и shell profiles, `globalStorageUri`, Settings Sync, автоматической активации views и `FileSystemWatcher`. Источники привязаны к плавающему `main`, хотя совместимость должна определяться минимальной `engines.vscode`; конкретная версия engines так и не названа. Несколько line anchors уже не совпадают с current main.
- **trigger**: воспроизводится при реализации этих пакетов или повторной проверке после изменения main
- **in_scope**: да
- **anchor**: правило «ни одно решение не опирается на API-факт вне таблицы»
- **evidence**: правило находится в [api-facts.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/api-facts.md:3>). Примеры отсутствующих контрактов: [Built-in Commands](https://code.visualstudio.com/api/references/commands), [Walkthrough completion events](https://code.visualstudio.com/api/references/contribution-points#contributeswalkthroughs), [Data Storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#data-storage), [Activation Events](https://code.visualstudio.com/api/references/activation-events#onview).
- **verification**: confirmed
- **verification_note**: все названные решения присутствуют в плане и отсутствуют среди 16 строк
- **fix_direction**: инвентаризировать все API-зависимые решения; фиксировать источник commit/tag, соответствующий минимальной engines.vscode, и устойчивый URL/символ

### codex-15

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: judgement
- **domain**: reliability
- **title**: Для файла правил не выбрана политика Settings Sync
- **mechanism**: `globalStorageUri` — локальный каталог; произвольные файлы из него не синхронизируются. Синхронизировать можно выбранные ключи `globalState`. Поэтому правила и действия молча исчезнут на второй машине, хотя roots намеренно machine-local.
- **trigger**: воспроизводится при использовании расширения на второй машине с включённым Settings Sync
- **in_scope**: да
- **anchor**: выбор хранилища пользовательских правил
- **evidence**: файл помещён в global storage в [00-overview.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/00-overview.md:119>); официальная документация различает локальный `globalStorageUri` и синхронизируемые ключи `globalState.setKeysForSync`: [Data Storage](https://code.visualstudio.com/api/extension-capabilities/common-capabilities#data-storage).
- **verification**: unverifiable
- **verification_note**: поведение API подтверждено, но желаемая продуктовая политика пользователем не задана
- **fix_direction**: явно выбрать machine-local, sync или export/import и объяснить выбранное поведение пользователю

### codex-16

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Первый релиз всё ещё содержит неинвалидируемый кэш QuickPick
- **mechanism**: Результат полного обхода хранится до конца сессии, хотя Hide/Add Root/Remove Root меняют множество проектов. Реактивность отложена до этапа 07, поэтому QuickPick показывает удалённые и скрытые проекты и не видит добавленные.
- **trigger**: первый Open Project, затем Hide или изменение roots, затем повторный Open Project
- **in_scope**: да
- **anchor**: контракт QuickPick первого релиза
- **evidence**: session result объявлен в [04-actions.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/04-actions.md:93>), хотя [00-overview.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/00-overview.md:147>) утверждает, что кэш целиком вынесен.
- **verification**: confirmed
- **verification_note**: session result является кэшем, но invalidation contract отсутствует
- **fix_direction**: не кэшировать список до этапа 07 либо перечислить и подключить все события его инвалидации

### codex-17

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Persistent cache key не включает все входы дерева
- **mechanism**: Ключ содержит только версию и hash rules, но дерево зависит также от roots, `descend`, `maxDepth`, symlink policy и прочих параметров discovery.
- **trigger**: воспроизводится после изменения корня, глубины или descend и следующего запуска
- **in_scope**: да
- **anchor**: контракт cache key
- **evidence**: ограниченный ключ описан в [07-cache-and-reactivity.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/07-cache-and-reactivity.md:25>), остальные входы — в [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:101>).
- **verification**: confirmed
- **verification_note**: объявление cache как hint не помогает, если перепроверка отменена или завершается ошибкой
- **fix_direction**: перечислить полный набор семантических входов и включить его в fingerprint

### codex-18

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Walkthrough завершается по запуску команды, а DoD требует успешного результата
- **mechanism**: `onCommand` отмечает шаг после запуска команды независимо от отмены wizard и факта записи roots. Поэтому body и DoD противоречат друг другу.
- **trigger**: пользователь запускает wizard из walkthrough и отменяет диалог
- **in_scope**: да
- **anchor**: completion первого шага walkthrough
- **evidence**: выбор `onCommand` находится в [05-onboarding.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/05-onboarding.md:23>), противоположный DoD — там же. Платформа отдельно поддерживает `onContext`: [Walkthrough completion events](https://code.visualstudio.com/api/references/contribution-points#contributeswalkthroughs).
- **verification**: confirmed
- **verification_note**: отмена wizard не отменяет факт запуска команды
- **fix_direction**: выбрать один критерий; если требуется успешная настройка, связывать completion с состоянием, выставляемым только после успешной записи

### codex-19

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: `.gitmodules` не покрывает штатную грамматику и deinitialized submodules
- **mechanism**: `.gitmodules` использует синтаксис git-config, включая quoted subsection, escapes, комментарии и значения с пробелами. Deinitialized submodule обычно имеет существующий пустой working directory, а не отсутствующий каталог, как предполагает план.
- **trigger**: `git submodule deinit` либо корректный `.gitmodules` с пробелами или escaping
- **in_scope**: да
- **anchor**: контракт `readSubmodulePaths`
- **evidence**: упрощённая модель находится в [02-core.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/02-core.md:101>). Первичные источники: [gitmodules](https://git-scm.com/docs/gitmodules), [gitsubmodules](https://git-scm.com/docs/gitsubmodules), [git-config syntax](https://git-scm.com/docs/git-config).
- **verification**: confirmed
- **verification_note**: worktree с `.git`-файлом модель маркера покрывает; проблема именно в парсере и неинициализированном состоянии
- **fix_direction**: определить UX deinitialized submodule и использовать совместимый с git-config разбор с нормализацией repo-relative paths

### codex-20

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: tests
- **title**: Два новых класса проверок не получили постоянного места в валидации
- **mechanism**: Production Vite build webview отсутствует в `pnpm check`, а проверки dependency-cruiser описаны как разовое внесение нарушения с последующим откатом, а не как сохраняемые regression fixtures. Ослабление архитектурного правила или ошибка bundling могут пройти обычный check.
- **trigger**: изменение Vite resolution/asset paths либо случайное ослабление `.dependency-cruiser.mjs`
- **in_scope**: да
- **anchor**: правило «класс проверок добавляется тем же пакетом, который его вводит»
- **evidence**: закрытый список check находится в [01-monorepo-and-tooling.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/01-monorepo-and-tooling.md:26>); production build вводится в [06-rules-editor.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/06-rules-editor.md:11>), а depcruise violations откатываются после ручной проверки.
- **verification**: confirmed
- **verification_note**: unit, integration и l10n получили постоянный дом; эти два класса — нет
- **fix_direction**: закрепить production webview build и исполняемые negative fixtures в постоянной CI-валидации

### codex-21

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Три решения round 01 внесены только декларативно
- **mechanism**: Не выбраны конкретное значение `engines.vscode` и числовой default `maxDepth`; для закрытого `Condition` не названо условие пересмотра. Формулировки «зафиксировать позже в этапе» не являются фиксацией контракта плана.
- **trigger**: воспроизводится при заполнении manifest либо появлении нового критерия классификации
- **in_scope**: да
- **anchor**: таблица принятых решений round 01
- **evidence**: решения перечислены в [review-01/REPORT.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/review-01/REPORT.md:113>); текущий план задаёт только семантику `maxDepth = 0` и обещает выбрать engines позднее.
- **verification**: confirmed
- **verification_note**: полный поиск по материалу не нашёл двух числовых значений и наблюдаемого условия открытия union
- **fix_direction**: перенести принятые решения в действующий контракт буквально

### codex-22

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: judgement
- **domain**: architecture
- **title**: Первый релиз перегружен инфраструктурой вокруг вторичных сценариев
- **mechanism**: До первого релиза одновременно проектируются три оси правил, sugar для трёх Git-режимов, пять action sinks с четырьмя shell grammars, два view id с собственным хранением раскрытия и полный onboarding. При этом требуемый пользователем визуальный редактор правил отложен. Сложность уже породила противоречия в ключевых контрактах.
- **trigger**: проявится как рост времени реализации и числа интеграционных дефектов до проверки основного сценария дерева
- **in_scope**: да
- **anchor**: состав первого релиза
- **evidence**: обоснование следует из совокупности этапов 02–05 и подтверждённых находок выше.
- **verification**: unverifiable
- **verification_note**: это продуктово-архитектурная оценка; допустимый объём первого релиза пользователем количественно не задан
- **fix_direction**: пересмотреть MVP вокруг одного режима обхода, минимального набора действий и одного размещения; возвращать расширения модели после проверки реального дерева

### codex-23

- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: reliability
- **title**: API-факт 6 не фиксирует условность декораций
- **mechanism**: Провайдер действительно глобален, но color/badge в custom tree зависят от `explorer.decorations.colors/badges`. Пользователь может отключить их вместе с Explorer decorations; утверждение «декорации видны в Explorer» также верно только для URI, для которого provider возвращает decoration.
- **trigger**: пользователь отключает Explorer decorations
- **in_scope**: да
- **anchor**: API-факт 6
- **evidence**: факт находится в [api-facts.md](</Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions/docs/plans/projects-tree/api-facts.md:17>); tree renderer читает общую настройку в [treeView.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/views/treeView.ts#L1335-L1344).
- **verification**: confirmed
- **verification_note**: глобальность регистрации подтверждена; безусловность отображения — нет
- **fix_direction**: уточнить предусловия факта и сохранить `TreeItemLabel.highlights` как независимый основной носитель

## Coverage

Проверены все восемь приоритетов. Полностью чистых приоритетов нет.

- **API facts:** по первичным источникам проверены **16 из 16**, без проверки принято **0**. Полностью подтверждены 14; факт 6 подтверждён условно; факт 15 частично ложен. Факт 14 подтверждён актуальной страницей [VS Code API l10n](https://code.visualstudio.com/api/references/vscode-api#l10n), а не указанным в таблице разделом.
- **Три оси:** исходный конфликт highlight/project действительно устранён; внутриосевая композиция и межосевая нормализация не закрыты.
- **Файл правил:** факты 11–13 и защита от workspace override подтверждены; lifecycle, concurrency и sync не закрыты.
- **Descend:** `stop`, `submodules`, `full`, path containment, nested/deinitialized submodules и git worktree проверены; `.git` как файл текущий `hasChild(any)` покрывает.
- **Этап 07:** вынос persistent cache и favicon из первого релиза корректен; cancellation и session cache фактически остались в этапе 04.
- **Untrusted/quoting:** argv-массив для process — правильное решение; terminal, URI/command sinks и nominality неполны.
- **Валидация:** unit/integration/l10n получили дом; production webview build и постоянные negative depcruise fixtures — нет.
- **Регрессия round 01:** внесены rootId, HighlightSpec, symlink metadata, `pathEquals`, признание перезапуска extension host, перенос QuickPick, Windows symlink check, перенос favicon/cache, Cursor check и отложенный rules editor. Не внесены фактические значения engines/maxDepth и условие пересмотра `Condition`.

Применимые `CLAUDE.md` и `AGENTS.md` в текущем каталоге и его родителях отсутствуют; их создание только запланировано этапом 01.

## Refuted

codex-24 | `TreeItemLabel.highlights` отсутствует в stable API | опровергнуто стабильным `vscode.d.ts` и маппингом highlights в `treeView.ts`

codex-25 | `.git` как файл делает worktree/submodule непроектом | опровергнуто: `hasChild` допускает `entryType: any`; Git действительно использует gitfile

codex-26 | Ошибка API-факта 15 ломает уже выбранную publish-схему | опровергнуто: 01-E переносит признак в output и не использует `secrets` непосредственно в `steps.if`

codex-27 | `FileDecoration.badge` имеет жёсткий лимит два символа | опровергнуто `vscode.d.ts` и ext-host validation

codex-28 | Для contributed view обязательно явно объявлять `onView` activation event | опровергнуто для `engines.vscode >= 1.74`: VS Code генерирует его автоматически, хотя явное объявление остаётся совместимым ([Activation Events](https://code.visualstudio.com/api/references/activation-events#onview))
