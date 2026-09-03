# Findings — review-04, реализация этапа 01 (reviewer: claude)

Все прогоны выполнены в рабочем дереве `feat/projects-tree-scaffold` на Node v26.7.0 / pnpm 11.1.3.
Базовая линия перед экспериментами: `pnpm check` → exit 0. После экспериментов: `pnpm check` → exit 0,
все тронутые файлы побайтово восстановлены (см. секцию «Что ломалось при проверке»).

---

### claude-01

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: architecture
- **title**: `no-vscode-in-core` не срабатывает на реальном коде: `vscode` резолвится в путь `@types/vscode`, а не в строку `vscode`
- **mechanism**: `@types/vscode` установлен как devDependency пакета `packages/projects-tree`, поэтому dependency-cruiser резолвит `import * as vscode from 'vscode'` в `node_modules/.pnpm/@types+vscode@1.85.0/node_modules/@types/vscode/index.d.ts` и присваивает зависимости `dependencyTypes: ['npm-dev', 'import']`. Матчер `to: { path: '^vscode$' }` сверяется с `resolved`, то есть с этим путём, и никогда не совпадает. Фикстура `tools/architecture-fixtures/no-vscode-in-core/**` краснеет только потому, что из `tools/**` пакет `@types/vscode` не резолвится (он не в корневых `devDependencies`), и depcruise отдаёт нерезолвленное имя `vscode`. То есть правило зелёное там, где должно быть красным, и красное там, где его проверяют. Тем же дефектом сломана `vscode`-половина `webview-is-isolated` (та же конструкция `^vscode$`). Побочный эффект связки: если `@types/vscode` когда-нибудь попадёт в корневые devDependencies, фикстуры перестанут нарушать правило и `depcruise:negative` покраснеет, указав на правила вместо реальной причины.
- **trigger**: воспроизводится в нормальной работе — любой обычный импорт `vscode` из `src/projects/**` в реальном пакете
- **in_scope**: да
- **anchor**: `.dependency-cruiser.mjs:27-34` (`no-vscode-in-core`), `.dependency-cruiser.mjs:55-59` (`webview-is-isolated`)
- **evidence**:
  ```js
  name: 'no-vscode-in-core',
  from: { path: '(^|/)src/projects/' },
  to: { path: '^vscode$' },
  ```
- **verification**: confirmed
- **verification_note**: создал `packages/projects-tree/src/projects/direct-violation.ts` с `import * as vscode from 'vscode'` и вызвал его из `src/extension.ts`. Результат: `pnpm run depcruise` → `✔ no dependency violations found`, **`pnpm check` → exit 0**. Тот же файл, не связанный с `extension.ts`, ронял только `knip` («Unused files»), то есть падение было случайным и к границе отношения не имело. JSON-отчёт depcruise показывает `resolved: node_modules/.pnpm/@types+vscode@1.85.0/.../index.d.ts`, `valid: true`. Всё удалено, базовая линия восстановлена.
- **fix_direction**: матчить зависимость на `vscode` не по `to.path`, а по признаку, устойчивому к резолву типов (например, комбинация `dependencyTypes` с именем пакета либо `to.path`, покрывающий и путь до `@types/vscode`); отдельно — привести фикстуру в те же условия резолва, что и реальный пакет, иначе она продолжит проверять другое явление. Добавить в `depcruise:negative` позитивный контроль: правило обязано срабатывать на нарушителе, размещённом внутри реального пакета, а не только в `tools/**`.

---

### claude-02

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: architecture
- **title**: Каталог под `src/`, не являющийся `projects/` или `editor/`, — дыра, не покрытая ни одним из шести правил
- **mechanism**: Все шесть правил заданы через `from`/`to` по путям `src/projects/`, `src/editor/`, `webview/src/`. Любой третий каталог (`src/shared/`, `src/infra/`, `src/util/`) не является ни `from`, ни `to` ни для одного правила. Модуль в нём может импортировать и `vscode`, и `node:fs`, а ядро — импортировать его; получается легальный путь отмывки обеих запрещённых зависимостей. Тот же каталог даёт webview дорогу в код расширения: `webview-is-isolated` запрещает только `src/(projects|editor)/`. Симметрично не покрыт и обратный ход: `src/editor/**` может импортировать внутренности подпредмета ядра напрямую, минуя `index` — `no-sibling-internals` ограничен парами внутри `CORE_SUBJECTS`.
- **trigger**: воспроизводится в нормальной работе — достаточно завести общий вспомогательный каталог, что для этапа 02+ обычный шаг
- **in_scope**: да
- **anchor**: `.dependency-cruiser.mjs:5` (`CORE_SUBJECTS`), `.dependency-cruiser.mjs:27-70` (все шесть правил)
- **evidence**:
  ```js
  const CORE_SUBJECTS = ['classification', 'discovery', 'actions'];
  // ...
  from: { path: '(^|/)webview/src/' },
  to: { path: '^vscode$|(^|/)src/(projects|editor)/' },
  ```
- **verification**: confirmed
- **verification_note**: создал `packages/projects-tree/src/shared/fs.ts` с импортом `node:fs` и `vscode`, импортировал его из `src/projects/classification/rules.ts`, из `src/editor/treeView/view.ts` вызвал внутренности `classification`, из `webview/src/leak.ts` импортировал `../../src/shared/fs`. Результат: `✔ no dependency violations found (9 modules, 7 dependencies cruised)`. Все файлы удалены.
- **fix_direction**: перевести правила с allow-list путей на deny-by-default: запретить ядру всё, кроме явно перечисленных источников, а не перечислять запрещённые каталоги; отдельно завести правило на «кто вправе импортировать внутренности подпредмета» без привязки к списку `CORE_SUBJECTS`, чтобы четвёртый подпредмет и слой `editor` попадали под него автоматически.

---

### claude-03

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: tests
- **title**: `depcruise:negative` проверяет «концепты», а не правила: пять из шести попарных правил `no-sibling-internals` можно удалить и всё останется зелёным
- **mechanism**: `ruleConcept()` срезает всё после `:` и сводит шесть правил `no-sibling-internals:<from>-><to>` к одному ожидаемому концепту. Фикстура существует только для одной пары (`discovery -> classification`). Инвариант, который скрипт умеет проверять, — «хотя бы одно правило с этим префиксом сработало хотя бы где-то», а заявленный в комментарии — «каждое из шести правил живо». Разница — пять незакрытых направлений: `classification->discovery`, `classification->actions`, `actions->classification`, `actions->discovery`, `discovery->actions`. Скрипт также не привязывает сработку к своей фикстуре, поэтому сработка одного правила на чужом каталоге тоже сойдёт за успех.
- **trigger**: воспроизводится в нормальной работе — рефактор `siblingInternalsRules()` (ровно тот сценарий, от которого скрипт заявлен как защита)
- **in_scope**: да
- **anchor**: `tools/depcruise-negative.mjs:20-32,71-84`
- **evidence**:
  ```js
  function ruleConcept(ruleName) {
    return ruleName.split(':', 1)[0];
  }
  ```
- **verification**: confirmed
- **verification_note**: заменил в `.dependency-cruiser.mjs` генерацию пар на единственную пару `{ from: 'discovery', to: 'classification' }` (пять правил из шести уничтожены). Результат: `pnpm run depcruise` → зелено, `pnpm run depcruise:negative` → `все 6 правил(а) сработали на своих фикстурах-нарушителях`, exit 0. Конфиг восстановлен из копии (md5 совпадает).
- **fix_direction**: сверять не префиксы концептов, а фактический набор имён правил из конфига с набором сработавших, и требовать сработки каждого правила на своей фикстуре (сопоставлять имя правила с каталогом фикстуры, а не собирать сработки в одно множество по всему прогону). Набор ожидаемых правил брать из самого конфига, а не из литерального списка в скрипте, иначе список будет расходиться с конфигом молча.

---

### claude-04

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: reliability
- **title**: Ни один workflow не синхронизирует версию манифеста с тегом — релиз всегда собирает `0.0.0`
- **mechanism**: `packages/projects-tree/package.json` содержит `"version": "0.0.0"`, а `release.yml`/`publish.yml` только вызывают `pnpm --filter projects-tree package` и публикуют полученный файл. Шага, который бы поднял версию из `GITHUB_REF_NAME`, нет; Changesets, заявленные планом 01-D («Changesets для версий и CHANGELOG»), не установлены и не настроены. Следствие: тег `v0.1.0` даст артефакт `projects-tree-0.0.0.vsix`, а `vsce publish --packagePath` попытается опубликовать версию `0.0.0`. Второй тег даст ту же версию — Marketplace отклонит повторную публикацию, и джоба покраснеет на этапе, когда GitHub Release уже создан. При этом `release.yml` вырезает из CHANGELOG секцию по версии из тега, то есть по `0.1.0`, — расхождение между версией заметок и версией артефакта заложено в конструкцию.
- **trigger**: воспроизводится в нормальной работе — на первом же реальном теге
- **in_scope**: да
- **anchor**: `packages/projects-tree/package.json:3`, `.github/workflows/release.yml:31-33`, `.github/workflows/publish.yml:33-35`
- **evidence**:
  ```yaml
  - name: Package projects-tree
    run: pnpm --filter projects-tree package
  ```
- **verification**: confirmed
- **verification_note**: в дереве лежит артефакт `packages/projects-tree/projects-tree-0.0.0.vsix`; `unzip -l` показывает `extension/package.json` с версией `0.0.0`. `grep -n "version" .github/workflows/*.yml` не находит ни одного шага, меняющего манифест. В `devDependencies` корня `@changesets/cli` отсутствует.
- **fix_direction**: выбрать один источник истины для версии (тег либо Changesets) и сделать его единственным: либо шаг, записывающий версию из тега в манифест до упаковки и проверяющий совпадение, либо полноценная настройка Changesets с релизом от их коммита. В обоих случаях добавить в `release.yml` проверку «версия в манифесте равна версии в теге», чтобы расхождение роняло сборку, а не публикацию.

---

### claude-05

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: security
- **title**: `publish.yml` держит оба PAT в `env` всей джобы — токены видны шагам установки и упаковки, исполняющим сторонние build-скрипты
- **mechanism**: `VSCE_PAT` и `OVSX_PAT` объявлены на уровне job, поэтому попадают в окружение каждого шага, включая `pnpm install --frozen-lockfile` и `pnpm --filter projects-tree package`. `pnpm-workspace.yaml` явно разрешает исполнение установочных скриптов пяти пакетам (`@vscode/vsce-sign`, `esbuild`, `keytar`, `lefthook`, `unrs-resolver`), а `vsce package` исполняет код расширения-агностичных зависимостей. Любая из них — как и любая их транзитивная подмена — читает оба токена публикации из `process.env` без каких-либо прав в workflow. Конструкция «секрет в `env` джобы» была принята как исправление ревью (в `if:` контекст `secrets` недоступен), но расширила область видимости с двух публикующих шагов до всех восьми.
- **trigger**: воспроизводится в нормальной работе — окружение доступно установочным скриптам при каждом прогоне; эксплуатация требует компрометации зависимости
- **in_scope**: да
- **anchor**: `.github/workflows/publish.yml:14-19`
- **evidence**:
  ```yaml
    env:
      VSCE_PAT: ${{ secrets.VSCE_PAT }}
      OVSX_PAT: ${{ secrets.OVSX_PAT }}
  ```
- **verification**: confirmed
- **verification_note**: `env` на уровне job по семантике GitHub Actions наследуется всеми шагами; в файле нет ни одного step-level `env`, сужающего область. Список исполняемых пакетов — `pnpm-workspace.yaml:4-9` (`allowBuilds`).
- **fix_direction**: разделить два требования, которые сейчас решаются одним механизмом: для гейта `if:` достаточно булева флага «секрет задан», вычисленного отдельным дешёвым шагом или job-output, а сам токен пробрасывать только в `env` конкретного публикующего шага. Дополнительно рассмотреть разнесение упаковки и публикации на две джобы, чтобы установка зависимостей вообще шла без секретов.

---

### claude-06

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: `depcruise:negative` не проверяет исключения из правил — контрольный образец `fileSystem.ts` объявлен, но ничем не утверждён
- **mechanism**: Фикстура `no-node-builtins-in-core-logic/src/projects/discovery/fileSystem.ts` помечена комментарием «Контрольный образец: порт ФС — единственное разрешённое место для node:fs», но скрипт собирает только множество сработавших правил и проверяет его на полноту. Утверждения «на контрольном образце правило НЕ сработало» в нём нет. Поэтому потеря `from.pathNot` (то есть исключения для порта ФС) не отличима от нормы: правило продолжит срабатывать на `classification/bad.ts` и негативная проверка останется зелёной. Класс дефекта общий для всех правил с исключениями: конфиг может стать чрезмерно широким, и единственный, кто это заметит, — разработчик этапа 02, столкнувшийся с ложным срабатыванием, после чего штатной реакцией будет ослабить правило.
- **trigger**: воспроизводится в нормальной работе — правка `pathNot` при рефакторе конфига
- **in_scope**: да
- **anchor**: `tools/depcruise-negative.mjs:71-84`, `.dependency-cruiser.mjs:43-49`
- **evidence**:
  ```js
  const missing = EXPECTED_RULE_CONCEPTS.filter((concept) => !firedConcepts.has(concept));
  if (missing.length > 0) {
  ```
- **verification**: confirmed
- **verification_note**: удалил из правила `no-node-builtins-in-core-logic` строку `pathNot: (^|/)src/projects/discovery/fileSystem\.ts$`, то есть уничтожил исключение целиком. `pnpm run depcruise:negative` → `все 6 правил(а) сработали`, exit 0. Конфиг восстановлен из копии.
- **fix_direction**: дополнить негативную проверку симметричным утверждением: перечислить файлы-контрольные образцы и требовать, чтобы по ним не пришло ни одной сработки указанного правила. Тогда и сработка, и её отсутствие становятся проверяемыми, а не только первая половина.

---

### claude-07

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: `contributes.jsonValidation` ссылается на файл схемы, которого нет ни в дереве, ни в `.vsix`
- **mechanism**: Манифест объявляет `url: ./schemas/projects-tree.rules.schema.json`. Каталога `schemas/` в пакете не существует, и `vsce ls` его не показывает — то есть вклад уезжает в установленное расширение битым. `vsce package` этого действительно не ловит (проверено), но VS Code при разрешении вклада получит несуществующий ресурс: валидация `projects-tree.rules.json` молча не работает, а в логе редактора появляется ошибка загрузки схемы. Это ровно тот режим отказа, против которого написан весь остальной тулинг этапа: заявлено в манифесте, не проверено машинно.
- **trigger**: воспроизводится в нормальной работе — при открытии файла, попадающего под `fileMatch`
- **in_scope**: да
- **anchor**: `packages/projects-tree/package.json:31-38`
- **evidence**:
  ```json
  "jsonValidation": [
    { "fileMatch": "projects-tree.rules.json",
      "url": "./schemas/projects-tree.rules.schema.json" }
  ]
  ```
- **verification**: confirmed
- **verification_note**: `pnpm exec vsce ls` в `packages/projects-tree` отдаёт ровно `package.json`, `README.md`, `LICENSE`, `l10n/bundle.l10n.json`, `dist/extension.js`. `unzip -l` собранного `.vsix` — те же 7 записей, `schemas/` отсутствует.
- **fix_direction**: либо перенести объявление вклада в этап, который заводит схему (по правилу «класс проверок вводит тот пакет, что его вводит» — то же и для вкладов), либо положить рядом минимальную валидную схему-заглушку. В любом случае — добавить в валидацию проверку, что каждый путь, упомянутый в `contributes`, существует в составе пакета; сейчас такой проверки нет ни в `pnpm check`, ни в CI.

---

### claude-08

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: contract
- **domain**: deps
- **title**: Dependabot с группой `patterns: ['*']` снимет намеренный точный пин `@types/vscode`
- **mechanism**: Точная версия `"@types/vscode": "1.85.0"` (без диапазона) выбрана намеренно, чтобы typecheck не разрешал API новее планки `engines.vscode`. Dependabot настроен на npm с единственной группой, ловящей все пакеты (`patterns: ['*']`), и не имеет ни `ignore` для `@types/vscode`, ни `versioning-strategy`. Первый же еженедельный прогон предложит поднять `@types/vscode` до текущей версии; PR пройдёт весь `pnpm check` зелёным, потому что подъём типов ничего не ломает — он именно что разрешает больше API. Гарантия «typecheck держит планку» исчезнет тихо, в автоматически смерженном dependency-PR.
- **trigger**: воспроизводится в нормальной работе — еженедельное расписание Dependabot
- **in_scope**: да
- **anchor**: контракт «`@types/vscode` пинится точно, чтобы typecheck не разрешал API новее `engines.vscode`» (план 01-D, `packages/projects-tree/package.json:44`) против `.github/dependabot.yml:3-11`
- **evidence**:
  ```yaml
      groups:
        npm-dependencies:
          patterns:
            - '*'
  ```
  ```json
  "@types/vscode": "1.85.0",
  ```
- **verification**: confirmed
- **verification_note**: в `.github/dependabot.yml` нет ни одной записи `ignore`; `grep -n "ignore" .github/dependabot.yml` пуст. Ничто в `pnpm check` не сверяет `@types/vscode` с `engines.vscode`.
- **fix_direction**: связать два значения машинно, а не соглашением: проверка, сверяющая версию `@types/vscode` с нижней границей `engines.vscode`, в составе `pnpm check` — тогда подъём типов уронит проверку независимо от того, кто его сделал. Исключение в Dependabot полезно как вторая линия, но само по себе оно тоже соглашение и потеряется при следующей правке конфига.

---

### claude-09

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: contract
- **domain**: tests
- **title**: Проверка состава `.vsix` через `vsce ls`, требуемая планом 01-D, не реализована нигде
- **mechanism**: План 01-D явно требует: «проверка состава пакета через `vsce ls` в CI: неожиданный файл — ошибка», а тестовый план этапа — «состав `.vsix` соответствует ожидаемому списку». В реализации `ci.yml` собирает пакет и загружает артефакт с `if-no-files-found: error`, но состав не сверяет ни с чем. `.vscodeignore` при этом написан списком исключений, то есть по умолчанию включает всё новое: любой файл, добавленный в `packages/projects-tree/` и не попавший под шаблон, уедет в `.vsix` молча. Сейчас состав корректен (проверено), но это состояние ничем не зафиксировано.
- **trigger**: воспроизводится в нормальной работе — добавление любого нового файла в каталог пакета
- **in_scope**: да
- **anchor**: контракт «проверка состава пакета через `vsce ls` в CI» (`docs/plans/projects-tree/01-monorepo-and-tooling.md`, пакет 01-D) против `.github/workflows/ci.yml:31-42` и `package.json:11-19`
- **evidence**:
  ```yaml
      - name: Package projects-tree
        run: pnpm --filter projects-tree package
      - name: Upload .vsix artifact
  ```
- **verification**: confirmed
- **verification_note**: `grep -rn "vsce ls" .github package.json packages/projects-tree/package.json` не находит ничего. Фактический состав на момент ревью — 5 файлов, соответствует ожидаемому, но проверки нет.
- **fix_direction**: зафиксировать ожидаемый состав как данные (эталонный список) и сверять с выводом `vsce ls` — с падением на любое расхождение в обе стороны, а не только на появление лишнего: выпадение `l10n` или `dist/extension.js` не менее опасно. Место проверки — `pnpm check`, а не только CI, по правилу самого канона «не добавляй проверку в CI, не заведя её в `pnpm check`».

---

### claude-10

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: `release.yml` и `publish.yml` не прогоняют `pnpm check` — тег публикует невалидированный код
- **mechanism**: Обе релизных джобы делают checkout, install, package и публикацию. Валидации в них нет. Связи с успешным прогоном `ci.yml` на том же коммите тоже нет: тег можно поставить на коммит, где CI красный или ещё не отработал, и релиз пройдёт. Для репозитория, который по замыслу ведёт агент и где вся гарантия качества сосредоточена в `pnpm check`, это единственный путь в продакшн, не проходящий через эту гарантию.
- **trigger**: воспроизводится в нормальной работе — тег на коммите с красным или незавершённым CI
- **in_scope**: да
- **anchor**: `.github/workflows/release.yml:16-33`, `.github/workflows/publish.yml:20-35`
- **evidence**:
  ```yaml
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Package projects-tree
        run: pnpm --filter projects-tree package
  ```
- **verification**: confirmed
- **verification_note**: `grep -n "pnpm check" .github/workflows/*.yml` даёт единственное вхождение — `ci.yml:29`. Ни `needs:`, ни `workflow_run`, ни проверки статуса коммита в релизных workflow нет.
- **fix_direction**: сделать валидацию предусловием публикации — либо шагом `pnpm check` в релизных джобах, либо гейтом на статус проверок коммита, — выбрав одно и записав почему. Второй вариант дешевле по времени, но требует, чтобы отсутствие статуса тоже считалось отказом, а не пропуском.

---

### claude-11

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: `AGENTS.md` описывает как существующее то, чего в репозитории нет, — агент не может отличить действующее правило от намерения
- **mechanism**: Канон написан в изъявительном наклонении про несуществующие сущности. Раздел «Layout» приводит дерево `src/projects/{classification,discovery,actions}` и `src/editor/{treeView,decorations,commands,onboarding,rulesEditor}` — ни одного из этих каталогов в дереве нет, есть только `src/extension.ts`. Раздел «Validation» утверждает: «Integration tests (`@vscode/test-cli`, script `test:integration`) are not part of `pnpm check`» — ни пакета, ни скрипта не существует, и по плану они появятся на этапе 03. Раздел «Language» утверждает: «Extension UI is bilingual (en + ru) through `package.nls.*` and `l10n` bundles» — `package.nls.json` отсутствует, `l10n/bundle.l10n.json` пуст (`{}`), русского бандла нет. Для документа, единственная функция которого — быть исполняемым предписанием, это существенно: агент, проверяющий «соответствует ли моя правка канону», получает от канона неотличимые друг от друга утверждения о факте и о плане, и штатной реакцией на расхождение будет правка канона под код — то есть ровно то, что канон запрещает делать с планами.
- **trigger**: воспроизводится в нормальной работе — на первой же задаче этапа 02, сверяющейся с каноном
- **in_scope**: да
- **anchor**: контракт `AGENTS.md` («Layout», «Validation», «Language») против фактического состава `packages/projects-tree/**`
- **evidence**:
  ```
  packages/projects-tree/src/
    extension.ts   — entry point: builds the object graph, registers contributions
    projects/      — core, subject "projects on disk"
  ```
  ```
  Integration tests (`@vscode/test-cli`, script `test:integration`) are not part of `pnpm check`
  ```
- **verification**: confirmed
- **verification_note**: `find packages/projects-tree/src packages/projects-tree/webview/src -type f` → только `src/extension.ts` и `webview/src/main.ts`. `grep -rn "test:integration" package.json packages/projects-tree/package.json` пуст. `cat packages/projects-tree/l10n/bundle.l10n.json` → `{}`; `package.nls.json` отсутствует.
- **fix_direction**: отделить в каноне действующее от планируемого явной пометкой (или вынести планируемое из канона в план целиком, оставив в `AGENTS.md` только проверяемые сейчас правила) и завести машинную сверку тех утверждений канона, которые вообще проверяемы: перечень шагов `pnpm check` в каноне против фактического состава скрипта `check`. Сейчас этот список — единственное место, где расхождение канона с реализацией было бы дешево ловить, и оно не ловится.

---

### claude-12

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: `.prettierignore` выводит `docs/**` из `format:check`, а вместе с ним — `docs/architecture.md`, который является материалом этапа
- **mechanism**: `.prettierignore` исключает весь `docs/` с обоснованием «владелец docs/** — пакет 01-C, форматирование планов вне области этого пакета». Но `docs/architecture.md` — это и есть поставка 01-C, и он оказался вне проверки вместе с планами. Границы владения между параллельными пакетами работ — состояние на один заход; исключение в `.prettierignore` — постоянное. После этапа 01 в `docs/` будет копиться документация, ни одна строка которой не проверяется `format:check`, при том что канон объявляет `format:check` первым шагом полной валидации. Тот же комментарий выводит из проверки `pnpm-workspace.yaml`.
- **trigger**: воспроизводится в нормальной работе — любая правка файла под `docs/`
- **in_scope**: да
- **anchor**: `.prettierignore:7-12`
- **evidence**:
  ```
  # Владелец docs/** — пакет 01-C, форматирование планов вне области этого пакета.
  docs/
  ```
- **verification**: confirmed
- **verification_note**: дописал в `docs/architecture.md` блок с тройными пустыми строками и хвостовыми пробелами; `pnpm exec prettier --check .` → `All matched files use Prettier code style!`. Контроль: та же операция на `.github/dependabot.yml` (не исключён) даёт `[warn] .github/dependabot.yml`. Файл восстановлен, `pnpm check` → exit 0.
- **fix_direction**: сузить исключение до того, что действительно не должно форматироваться (планы под `docs/plans/**`, если для них есть причина), и убрать из-под него поставки, которые репозиторий обязуется держать отформатированными. Обоснование исключения записать через свойство файла, а не через имя пакета работ: имя пакета перестанет что-либо значить сразу после этапа 01.

---

### claude-13

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: `tools/*.mjs` не покрыт ни typecheck, ни типизированным линтингом — наименее проверенный файл репозитория это скрипт, охраняющий проверки
- **mechanism**: Корневой `tsconfig.json` включает `["*.ts", "*.mts", "tools/**/*.ts", "tools/**/*.mts"]`; `.mjs` в него не попадает, `allowJs`/`checkJs` не включены. В `eslint.config.mjs` для `tools/**/*.mjs` и вообще для `**/*.mjs` применён `disableTypeChecked`. Итог: `tools/depcruise-negative.mjs` (≈115 строк логики разбора JSON-отчёта) и `packages/projects-tree/esbuild.mjs` проверяются только нетипизированными правилами. Для скрипта, который обращается к `report.modules`, `dependencyModule.dependencies`, `dependency.rules` без каких-либо гарантий формы, это значимо: смена схемы вывода dependency-cruiser между мажорными версиями даст либо исключение (это ещё нормально — красное), либо пустое множество сработок с последующим ложным падением, и ни одна проверка не поймает изменение формата раньше.
- **trigger**: воспроизводится в нормальной работе — мажорный апдейт dependency-cruiser, который Dependabot предложит группой `['*']`
- **in_scope**: да
- **anchor**: `tsconfig.json:8-9`, `eslint.config.mjs:52-63`
- **evidence**:
  ```json
  "include": ["*.ts", "*.mts", "tools/**/*.ts", "tools/**/*.mts"],
  ```
  ```js
    files: ['tools/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  ```
- **verification**: confirmed
- **verification_note**: контроль в обратную сторону — создал `tools/typed-violation.ts` с плавающим Promise; `pnpm exec eslint tools/` дал `@typescript-eslint/no-floating-promises`, то есть типизированный линтинг для `tools/**/*.ts` работает и отключён именно для `.mjs`. Файл удалён.
- **fix_direction**: перевести скрипты тулинга на `.ts` (они и так исполняются под Node 26 с нативной поддержкой TS) либо включить для них `checkJs` и снять `disableTypeChecked`, дав вывод dependency-cruiser явный тип. Одновременно решить, что делать с `esbuild.mjs`: единообразие важнее, чем удобство одного файла.

---

### claude-14

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: `activationEvents: []` расходится с планом («по обоим id view»), и расхождение нигде не записано
- **mechanism**: План 01-D предписывает `activationEvents` «по обоим id view (см. 03-C)». Реализация — пустой массив. Для заглушки это защитимо (view ещё нет, и объявленное событие активации на несуществующий view было бы мертвее пустого массива), но: (1) `contributes` не содержит ни одного вклада, способного вызвать активацию, поэтому `main` в поставленном `.vsix` не выполняется никогда — DoD 01-D «дерево-заглушка видна» этим не подтверждается; (2) отклонение от плана не зафиксировано ни в плане, ни в `AGENTS.md`, ни в README, то есть агент этапа 03 не отличит «намеренно отложено» от «забыли».
- **trigger**: воспроизводится в нормальной работе — установленное расширение не активируется
- **in_scope**: да
- **anchor**: контракт «`activationEvents` — по обоим id view» (план 01-D) против `packages/projects-tree/package.json:30`
- **evidence**:
  ```json
  "activationEvents": [],
  ```
- **verification**: confirmed
- **verification_note**: `contributes` содержит только `jsonValidation`; вкладов `views`/`commands` нет, следовательно ни одного триггера активации. `src/extension.ts` — пустой `activate`.
- **fix_direction**: зафиксировать решение там, где его будет искать следующий агент: записать в план как сознательно изменённое решение (`activationEvents` заполняется этапом 03 вместе с view) и уточнить формулировку DoD 01-D, которая сейчас требует видимого дерева от пакета, где дерева нет.

---

### claude-15

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: architecture
- **title**: `no-node-builtins-in-core-logic` запрещает ядру все встроенные модули Node, хотя объявлен про `node:fs`
- **mechanism**: Матчер `to: { dependencyTypes: ['core'] }` покрывает любой builtin: `node:path`, `node:url`, `node:assert`, `node:util`, `node:crypto`. Имя правила, его комментарий и формулировка плана говорят исключительно про `node:fs` и обосновывают запрет тестируемостью на фейковой ФС — к `node:path` это обоснование не относится вовсе. Разбор путей в правилах классификации — предметная необходимость ядра, и на этапе 02 правило сработает на легитимном коде. Штатная реакция на ложное срабатывание «правила, которое и так уже красное» — ослабить его; при этом единственный способ ослабить `dependencyTypes: ['core']` точечно — начать перечислять исключения по путям файлов, что размывает границу вместо её проведения. Проверка `depcruise:negative` эту чрезмерность не видит (см. claude-06).
- **trigger**: воспроизводится в нормальной работе — первый импорт `node:path` в ядре на этапе 02
- **in_scope**: да
- **anchor**: `.dependency-cruiser.mjs:36-50`
- **evidence**:
  ```js
      from: { path: '(^|/)src/projects/',
        pathNot: String.raw`(^|/)src/projects/discovery/fileSystem\.ts$` },
      to: { dependencyTypes: ['core'] },
  ```
- **verification**: confirmed
- **verification_note**: JSON-отчёт depcruise присваивает `dependencyTypes: ['core', 'import']` любому встроенному модулю (в моём прогоне — `fs`, резолв `node:fs` → `fs`, что и описано в комментарии к правилу). Ограничения на имя модуля в правиле нет, поэтому множество запрещённого — все builtins.
- **fix_direction**: сузить `to` до тех builtins, к которым относится обоснование (модули доступа к ФС и процессу), оставив чистые вычислительные вне запрета; список запрещённого держать явным и объяснённым в самом правиле, чтобы следующее расширение списка требовало обоснования, а не происходило по умолчанию.

---

### claude-16

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: Установка git-хуков ничем не подстрахована: она держится только на build-скрипте `lefthook` в `allowBuilds`
- **mechanism**: `lefthook.yml` описывает pre-commit и commit-msg, но ни в корневом `package.json`, ни в пакетах нет скрипта `prepare`/`postinstall`, вызывающего `lefthook install`. Хуки в `.git/hooks` присутствуют только потому, что npm-пакет `lefthook` ставит их своим собственным установочным скриптом, а тот исполняется лишь благодаря записи `lefthook: true` в `allowBuilds`. Эта запись, по описанию самого материала, дописана `pnpm approve-builds` побочно, во время работы другого пакета работ. Убрать её (или получить `pnpm install --ignore-scripts`, обычное для CI и для аудита зависимостей) — и хуки перестают ставиться, без единой ошибки; коммиты в невалидном формате и неотформатированные файлы начнут проходить локально. Ни одна из семи проверок `pnpm check` не проверяет наличие хуков.
- **trigger**: воспроизводится в нормальной работе — свежий клон с `--ignore-scripts` либо удаление записи из `allowBuilds`
- **in_scope**: да
- **anchor**: `package.json:9-20` (нет `prepare`), `pnpm-workspace.yaml:4-9`, `lefthook.yml:1-18`
- **evidence**:
  ```yaml
  allowBuilds:
    "@vscode/vsce-sign": true
    esbuild: true
    keytar: true
    lefthook: true
    unrs-resolver: true
  ```
- **verification**: confirmed
- **verification_note**: `grep -n "prepare\|postinstall" package.json packages/projects-tree/package.json` → ничего. Хуки `.git/hooks/{pre-commit,commit-msg,prepare-commit-msg}` в дереве есть, то есть механизм сработал, но зависит целиком от исполнения установочного скрипта. `pnpm install --frozen-lockfile` проходит без предупреждений об пропущенных build-скриптах.
- **fix_direction**: сделать установку хуков явной и наблюдаемой — отдельным скриптом жизненного цикла, не зависящим от внутреннего поведения пакета, — и добавить в `pnpm check` дешёвую проверку, что хуки установлены и соответствуют текущему `lefthook.yml`. Отдельно стоит убедиться, что `keytar` в `allowBuilds` действительно нужен: это транзитивная зависимость `vsce`, и разрешение ей собирать нативный код — расширение поверхности установки.

---

### claude-24

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: judgement
- **domain**: architecture
- **title**: Что в этой инфраструктуре лишнее для репозитория с одним расширением-заглушкой
- **mechanism**: Оценка соотношения «стоимость поддержки тулинга / что он сейчас охраняет». Фактический предмет охраны — 12 строк кода в двух файлах: `src/extension.ts` (пустые `activate`/`deactivate`) и `webview/src/main.ts` (`export {}`). Прогон `pnpm run depcruise` сообщает `3 modules, 1 dependencies cruised` — шесть архитектурных правил, шесть каталогов фикстур и скрипт негативной проверки на 115 строк обслуживают граф из одной зависимости. Это не аргумент против архитектурных правил как таковых (для репозитория, который ведёт агент, машинная граница действительно дешевле ревью), но у конкретных элементов цена уже проявилась: (1) фикстуры живут в другом контексте резолва, чем реальный код, и именно это породило claude-01 — самый серьёзный дефект этапа, где правило зелёное на реальном нарушении и красное на фикстуре; (2) шесть попарных правил вместо одного породили claude-03; (3) пакет `webview` заведён вместе с tsconfig, package.json и заглушкой ради этапа 06, при этом `no-sibling-internals` и половина остальных правил описывают каталоги, которых не существует. Отдельно избыточен `keytar` в `allowBuilds` (транзитив `vsce`, нативная сборка при установке) и `pnpm-lock.yaml` в `eslint.config.mjs:ignores` (ESLint не разбирает YAML, запись ничего не делает). Обратная сторона: `AGENTS.md`, `docs/architecture.md`, `.gitattributes` и правило «класс проверок вводит тот пакет, что его вводит» — наоборот, дешёвые и работающие; сокращать стоит машинерию, чьи фикстуры проверяют не то, что охраняют, а не документы.
- **trigger**: недостижим — оценка, а не дефект
- **in_scope**: да
- **anchor**: соотношение `tools/architecture-fixtures/**` (6 каталогов, 11 файлов) + `.dependency-cruiser.mjs` (6 правил) + `tools/depcruise-negative.mjs` против `packages/projects-tree/src/extension.ts` и `packages/projects-tree/webview/src/main.ts`
- **evidence**: `pnpm run depcruise` → `✔ no dependency violations found (3 modules, 1 dependencies cruised)`; `find packages/projects-tree/src packages/projects-tree/webview/src -type f` → 2 файла
- **verification**: unverifiable
- **verification_note**: суждение о соразмерности инфраструктуры; проверке кодом не подлежит. Фактические числа, на которых оно построено, приведены прогонами и проверяемы.
- **fix_direction**: не сокращать состав, а изменить способ проверки границ так, чтобы он не требовал параллельного дерева фикстур в чужом контексте резолва: нарушители, живущие внутри реального пакета и удаляемые самой проверкой, снимают и claude-01, и claude-03, и половину стоимости поддержки. Отдельно — убрать заведомо неработающие записи (`pnpm-lock.yaml` в ignores ESLint) и пересмотреть необходимость `keytar` в `allowBuilds`.

---

### claude-17

- **reviewer**: claude
- **severity**: LOW
- **kind**: contract
- **domain**: style
- **title**: Предупреждение про symlink на Windows размещено не там, где требует DoD 01-C
- **mechanism**: DoD 01-C: «в README сказано, что на Windows без `core.symlinks=true` файл придёт текстом». Текст написан хорошо и подробно, но лежит в `docs/architecture.md`. Корневой `README.md` — 47 байт и ничего про это не говорит. Адресат предупреждения — человек, который только что клонировал репозиторий на Windows; он читает README, а не документ об архитектуре границ.
- **trigger**: воспроизводится в нормальной работе — клон на Windows без `core.symlinks`
- **in_scope**: да
- **anchor**: контракт DoD 01-C («в README сказано…») против `README.md` и `docs/architecture.md:29-46`
- **evidence**:
  ```
  ## Почему CLAUDE.md — симлинк, а не копия AGENTS.md
  ### Поведение на Windows
  ```
- **verification**: confirmed
- **verification_note**: `wc -c README.md` → 47; `grep -in "symlink\|windows\|core.symlinks" README.md` пуст. `git ls-files -s CLAUDE.md` → `120000` (вторая половина того же DoD выполнена).
- **fix_direction**: перенести или продублировать краткое предупреждение в README со ссылкой на подробное обоснование, оставив разбор в `docs/architecture.md`.

---

### claude-18

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: style
- **title**: `ci.yml` запускает полный прогон дважды на каждый коммит в PR
- **mechanism**: Триггеры — `push: branches: ['**']` и `pull_request` без фильтра. Для ветки с открытым PR коммит порождает оба события; `concurrency.group` включает `github.ref`, который у push-события (`refs/heads/<branch>`) и у pull_request-события (`refs/pull/<n>/merge`) различается, поэтому отмены не происходит. Каждый коммит в PR стоит двух полных прогонов `pnpm check` + упаковки + загрузки артефакта. На публичном репозитории с одним расширением это не блокер, но заявленной цели «CI дополняет `pnpm check`» удвоение не служит.
- **trigger**: воспроизводится в нормальной работе — каждый коммит в ветку с открытым PR
- **in_scope**: да
- **anchor**: `.github/workflows/ci.yml:3-12`
- **evidence**:
  ```yaml
  on:
    push:
      branches: ['**']
    pull_request:
  ```
- **verification**: confirmed
- **verification_note**: `actionlint` по всем трём workflow — exit 0, замечаний нет; дублирование не является синтаксической ошибкой и им не ловится. Значения `github.ref` для двух событий различаются по определению GitHub Actions, поэтому общая группа concurrency не образуется.
- **fix_direction**: выбрать одну модель — либо push только по основной ветке плюс pull_request, либо push по всем ветвям и никакого pull_request, — и привести `concurrency.group` к ключу, общему для обоих событий (например, к идентификатору PR с откатом на ref), чтобы отмена работала.
- **note**: остальные аспекты безопасности `ci.yml` проверены и признаны чистыми — см. coverage (приоритет 2).

---

### claude-19

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: style
- **title**: CHANGELOG репозитория объявляет себя источником релизных заметок каждого расширения, но `release.yml` режет его только по версии
- **mechanism**: `CHANGELOG.md` утверждает: «Each extension's own release notes are cut from this file when it is published», и структурирует содержимое подсекциями по расширению (`### projects-tree`). `release.yml` вырезает секцию `## [<version>]` целиком, без фильтрации по расширению. Пока расширение одно, разницы нет; со вторым расширением релиз одного из них получит заметки обоих. Кроме того, в `.vsix` нет собственного CHANGELOG (`vsce ls` его не показывает — в каталоге пакета файла нет), поэтому вкладка изменений в Marketplace будет пустой.
- **trigger**: только на рукотворном входе сейчас; воспроизводится в нормальной работе при появлении второго расширения
- **in_scope**: да
- **anchor**: `CHANGELOG.md:3-6`, `.github/workflows/release.yml:35-56`
- **evidence**:
  ```
  extension's own release notes are cut from this file when it is published.
  ```
- **verification**: confirmed
- **verification_note**: прогнал awk-выражение из workflow вручную по `CHANGELOG.md` для `Unreleased`, `0.1.0`, `0.0.0`. Для `Unreleased` вернулась вся секция, включая заголовок `### projects-tree`, — фильтрации по расширению в выражении нет. Для отсутствующих версий вывод пуст, то есть fallback на generic note работает корректно.
- **fix_direction**: либо привести формат CHANGELOG к тому, что workflow действительно умеет (одна секция на версию, без обещания разреза по расширению), либо научить разбор фильтровать подсекцию по имени расширения — и в обоих случаях решить, как в `.vsix` попадёт changelog для Marketplace.

---

### claude-20

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: Production-сборка идёт минифицированной и полностью без sourcemap
- **mechanism**: `sourcemap: !isProd` в паре с `minify: isProd` даёт для `--prod` минифицированный бандл без карты. Именно этот бандл уезжает в `.vsix` (скрипт `package` вызывает `build:prod`), то есть стектрейсы из установленного у пользователя расширения будут указывать на позиции в минифицированном однострочнике и не приводятся к исходникам. Для расширения, которое ходит по ФС и запускает процессы, отсутствие возможности разобрать отчёт об ошибке — обычная причина невоспроизводимых баг-репортов.
- **trigger**: воспроизводится в нормальной работе — любая необработанная ошибка в установленном расширении
- **in_scope**: да
- **anchor**: `packages/projects-tree/esbuild.mjs:14-15`
- **evidence**:
  ```js
    sourcemap: !isProd,
    minify: isProd,
  ```
- **verification**: confirmed
- **verification_note**: `unzip -l projects-tree-0.0.0.vsix` содержит `extension/dist/extension.js` и не содержит `.map`; `.vscodeignore` исключает `**/*.map` безусловно. Прочее в `esbuild.mjs` (`platform: node`, `format: cjs`, `external: ['vscode']`, `target: node18`) проверено и корректно — см. coverage.
- **fix_direction**: разделить два решения, которые сейчас связаны одним флагом: минификация и наличие карты независимы. Определить, где карта должна жить (в пакете либо только в артефакте CI/релиза для последующего разбора), и согласовать это с `.vscodeignore`, который сейчас вырезает карты безусловно.

---

### claude-21

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: `release.yml` подставляет версию в awk-регэксп без экранирования
- **mechanism**: `$0 ~ "^## \\[" ver "\\]"` собирает регулярное выражение из значения `ver`, полученного из имени тега. Точки в версии остаются метасимволами: для тега `v1.0.0` выражение совпадёт и с заголовком `## [1.0.0]`, и с `## [1a0b0]`. Практический риск близок к нулю (столкновение требует специально построенного заголовка), но это тот же класс дефекта, что и остальные проверки этапа: поведение зависит от данных, которые в регэксп попадать не должны.
- **trigger**: только на рукотворном входе — требует заголовка в CHANGELOG, совпадающего с версией по маске
- **in_scope**: да
- **anchor**: `.github/workflows/release.yml:41-47`
- **evidence**:
  ```sh
  if ($0 ~ "^## \\[" ver "\\]") { found = 1; next }
  ```
- **verification**: confirmed
- **verification_note**: прогнал awk локально; сопоставление с заголовком идёт по префиксу как регулярное выражение, точки не экранированы. Остальная логика разбора (выход на следующей секции, fallback при пустом результате) проверена и корректна.
- **fix_direction**: сравнивать заголовок строкой, а не регулярным выражением, либо экранировать метасимволы версии перед подстановкой.

---

### claude-22

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: style
- **title**: `.gitignore` не исключает `.idea/`, и каталог уже лежит в дереве неотслеженным
- **mechanism**: `.gitignore` перечисляет `node_modules/`, `dist/`, `out/`, `*.vsix`, `.vscode-test/`. Каталог `.idea/` (6 файлов, включая `workspace.xml` с локальным состоянием IDE) присутствует в дереве и показывается `git status` как неотслеженный. Первый `git add -A`, сделанный агентом или человеком, внесёт его в историю публичного репозитория. Симметрично отсутствует `.vscode/` — при этом `.vscodeignore` пакета его исключает, то есть ожидание, что каталог появится, в материале уже есть.
- **trigger**: воспроизводится в нормальной работе — `git add -A` в текущем состоянии дерева
- **in_scope**: да
- **anchor**: `.gitignore:1-5`
- **evidence**:
  ```
  node_modules/
  dist/
  out/
  *.vsix
  .vscode-test/
  ```
- **verification**: confirmed
- **verification_note**: `git status --short` показывает `?? .idea/`; `find .idea -type f` даёт 6 файлов, включая `workspace.xml`.
- **fix_direction**: добавить локальные каталоги IDE в `.gitignore`, решив заодно, что делать с `.vscode/` — для репозитория расширения его часть (`launch.json`, рекомендуемые расширения) обычно наоборот версионируется, и это стоит решить явно, а не оставить на первый `git add`.

---

### claude-23

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: style
- **title**: `vitest run` печатает предупреждение о ESM-в-CJS при каждом прогоне `pnpm check`
- **mechanism**: В корневом `package.json` нет `"type": "module"`, а `vitest.config.ts` написан в ESM-синтаксисе. Vite грузит его через CJS-загрузчик и предупреждает, что в будущей мажорной версии загрузчик станет нативным. Значение для этапа — не сам warning, а то, что финальный шаг полной валидации всегда завершается непустым шумом: это ровно тот фон, на котором перестают замечать реальные предупреждения.
- **trigger**: воспроизводится в нормальной работе — каждый прогон `pnpm check`
- **in_scope**: да
- **anchor**: `vitest.config.ts:1`, `package.json:1-8`
- **evidence**:
  ```
  (!) Your Vite config uses features that are unsupported by `configLoader: 'native'`
    - ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1).
  ```
- **verification**: confirmed
- **verification_note**: предупреждение воспроизводится в каждом прогоне `pnpm check` (exit 0). Само содержимое `vitest.config.ts` проверено: `include`/`exclude` корректно покрывают `packages/**/src` и `tools/**` и исключают фикстуры.
- **fix_direction**: устранить неоднозначность формата модулей на уровне корневого пакета либо расширения файла конфигурации — выбрав вариант, совместимый с тем, что `.mjs`-конфиги в репозитории уже используются повсеместно.

---

## Coverage

Проверено исполнением и признано чистым (то есть проверял и находок нет) — по восьми приоритетам брифа:

**Приоритет 1 (проверки, которые не проверяют).** Находки: claude-01, claude-02, claude-03, claude-06, claude-13, claude-15. Чисто:
- `pnpm check` целиком — базовая линия exit 0 подтверждена дважды (до и после экспериментов); порядок семи шагов в скрипте `check` совпадает с объявленным в `AGENTS.md` и в плане 01-B, каждый шаг вызывается и его код возврата не маскируется.
- **Прямая проверка DoD 01-B «неотформатированный файл роняет `check`»** — подтверждена: `pnpm check` упал именно на `format:check` (`[warn] .../rules.ts`), exit 1.
- **`eslint.config.mjs`, типизированный линтинг** — покрытие реально работает во всех трёх местах: приманка с плавающим Promise дала `@typescript-eslint/no-floating-promises` в `tools/**/*.ts`, в `packages/projects-tree/src` и в `packages/projects-tree/webview/src` (последний — с корректно подключённым `lib: DOM`). `projectService: true` + `tsconfigRootDir` настроены верно, все файлы находят свой проект, ошибок «file not included in project» нет. Единственный пробел — `.mjs`, вынесен в claude-13.
- **`knip.json`** — не игнорирует существенного, проверено тремя приманками: неиспользуемая корневая devDependency → `Unused devDependencies (1)`; мёртвый export в достижимом файле ядра → `Unused exports (1)`; недостижимые файлы в `tools/` и в пакетах → `Unused files`. Корневой workspace покрыт несмотря на отсутствие явной секции. `ignore` для фикстур — обоснован (иначе фикстуры-нарушители всегда были бы «мёртвыми»).
- **`vitest.config.ts` + `tools/smoke.test.ts`** — заглушка ничего не маскирует: `include` покрывает `packages/**/src/**` (включая webview) и `tools/**`, `exclude` исключает фикстуры; тест выполняется реально (1 passed), а не пропускается. Роль заглушки (не дать `vitest run` упасть на «нет тестов») в комментарии зафиксирована честно. Косметика — claude-23.
- **`depcruise:negative`, третий вектор** — запрошенный брифом вектор найден и подтверждён прогоном (claude-03: удаление 5 из 6 правил не краснеет). Четвёртый — отсутствие утверждений об исключениях (claude-06). Прочая механика скрипта проверена и корректна: коды возврата 0/1 dependency-cruiser различаются осознанно, неожиданный код и неразбираемый JSON бросают исключение, отсутствие фикстур дало бы пустое множество сработок и красный результат.
- **`.dependency-cruiser.mjs`, правила `core-must-not-know-editor`, `no-sibling-internals` (в реализованной паре), `no-circular`** — на своих фикстурах срабатывают корректно; `tsPreCompilationDeps: true` включён, поэтому type-only импорты не проходят мимо (проверено: depcruise видит зависимость `extension.ts` с `dependencyTypes: ['npm-dev','type-only','import']`). `doNotFollow: node_modules` задан.
- `commitlint` — отвергает невалидное сообщение (`✖ type may not be empty`, exit ≠ 0), конфигурация `config-conventional` подключена.

**Приоритет 2 (CI и безопасность workflow).** Находки: claude-05, claude-10, claude-18, claude-21. Чисто:
- `actionlint` по всем трём workflow — **exit 0**, ни одного замечания.
- `--frozen-lockfile` присутствует во **всех трёх** workflow (`ci.yml:27`, `release.yml:30`, `publish.yml:32`) — заявленного брифом дефекта нет. Локально `pnpm install --frozen-lockfile` проходит, то есть лок-файл действительно синхронен манифестам.
- `permissions:` объявлены явно во всех трёх и минимальны для задачи: `ci.yml` → `contents: read`; `release.yml` → `contents: write` (нужно для создания релиза); `publish.yml` → `contents: read`. Ни одного `write-all`, ни одного `id-token`/`packages` без нужды.
- Риск для форков в `ci.yml` — приемлемый: триггер `pull_request` (а не `pull_request_target`), поэтому код PR исполняется в контексте без доступа к секретам репозитория; `GITHUB_TOKEN` ограничен `contents: read`; ни один шаг не использует `secrets`; артефакт `.vsix` пишется в область прогона PR. Известной дыры класса «pwn request» здесь нет.
- Все actions запинены на мажорные теги от известных издателей (`actions/checkout@v5`, `actions/setup-node@v4`, `pnpm/action-setup@v4`, `actions/upload-artifact@v4`, `softprops/action-gh-release@v2`); ни одного обращения к неизвестному действию. Пиннинг по SHA отсутствует — сознательный компромисс, не отмечаю находкой при `contents: read` в CI.
- Ни одного `continue-on-error`, маскирующего провал публикации, — требование плана 01-E соблюдено.
- Исправление ревью в `publish.yml` (гейт по `env.*` вместо `secrets.*` в `if`) корректно по существу: `env.VSCE_PAT != ''` в `if` вычисляется, `secrets` в `if` действительно недоступен. Шаг «Report skipped publishers» отчитывается о пропуске явно и не притворяется успехом. Новая дыра, возникшая от этого исправления, — расширение области видимости токенов (claude-05).
- Интерполяция `${{ steps.vsix.outputs.path }}` в `run:` — значение получено от `find` по собственному дереву, не от пользовательского ввода; инъекции нет. `OVSX_PAT` передаётся в `ovsx` через переменную окружения (`"$OVSX_PAT"`), а не через литерал в командной строке — верно.
- Поведение `awk` на отсутствующей секции CHANGELOG — **проверено прогоном для `Unreleased`, `0.1.0`, `0.0.0`**: отсутствующая секция даёт пустой файл, срабатывает fallback на generic note, `fail_on_unmatched_files: true` не даёт выпустить релиз без `.vsix`. Логика «выйти на следующем `## [`» корректна, последняя секция файла читается до EOF.
- `dependabot.yml` — оба экосистемы (npm, github-actions) объявлены, `directory: /` корректен для pnpm-workspace с корневым лок-файлом. Проблема только с группировкой пина (claude-08).

**Приоритет 3 (швы между пакетами работ).** Находки: claude-12, claude-16. Чисто, с поимённым разбором общих точек:
- **корневой `package.json` (01-B) против `packages/projects-tree/package.json` (01-D)** — расхождений нет: `typescript` совпадает по диапазону (`^5.7.3` в обоих), корневой скрипт `typecheck` рассчитывает на `pnpm -r run typecheck` и оба пакета такой скрипт имеют, `engines.node` объявлен только в корне (для тулинга) и не дублируется в пакете, что верно.
- **`tsconfig.base.json` (01-A) против корневого `tsconfig.json` (01-B)** — шов корректный: `tsconfig.json` расширяет базу и переопределяет только `types: ["node"]` и `include`/`exclude`; исключение `tools/architecture-fixtures/**` обязательно (иначе `tsc` упал бы на фикстурах с `import * as vscode`) и присутствует. `pnpm -r run typecheck` покрывает оба пакета — подтверждено выводом (`Scope: 2 of 3 workspace projects`, оба Done).
- **`pnpm-workspace.yaml` после `pnpm approve-builds`** — содержимое корректно: `packages: ['packages/*', 'packages/*/webview']` даёт ровно три проекта (`pnpm -r list --depth -1`: root, `projects-tree`, `projects-tree-webview` — DoD 01-A подтверждён), синтаксис `allowBuilds` как отображения принят pnpm 11.1.3 без предупреждений, все пять записей соответствуют реально устанавливаемым пакетам. Замечание по составу (`keytar`) и по зависимости хуков от этого файла — claude-16, claude-24.
- **Какую форму входа не покрыл ни один пакет** (прямой ответ на вопрос брифа): **согласованность манифеста расширения с релизным процессом.** 01-D владел манифестом и зафиксировал `version: 0.0.0`; 01-E владел workflow и написал релиз от тега; ни один из двух не отвечал за то, как одно превращается в другое, и Changesets, которые должны были быть этим мостом, не реализовал никто (claude-04). Второй непокрытый шов того же рода — согласованность `contributes` с составом пакета: 01-D объявил `jsonValidation` со ссылкой на файл, который заведёт этап 02, а проверку состава `.vsix`, которая это поймала бы, план поручал тому же 01-D, и она не сделана (claude-07, claude-09).

**Приоритет 4 (манифест расширения).** Находки: claude-07, claude-08, claude-14. Чисто:
- `publisher: fractalizer` — проходит `validatePublisher` (`^[a-z0-9][a-z0-9-]*$/i`, без точек), id `fractalizer.projects-tree` фиксируется до первой публикации, как и предписано планом.
- `engines.vscode: ^1.85.0` при `@types/vscode: 1.85.0` — согласованы; точный пин действительно ограничивает typecheck планкой (механизм верен, риск его потери — claude-08).
- `capabilities.untrustedWorkspaces: limited` с непустым `description` — присутствует, то есть расширение не отключается целиком в Restricted Mode (требование факта 15).
- `capabilities.virtualWorkspaces: false` с описанием — соответствует тому, что ядро планируется на `node:fs`.
- `l10n: ./l10n` — задан, каталог существует, `bundle.l10n.json` присутствует в `.vsix` (требование факта 19 по наличию поля выполнено; пустота бандла и отсутствие `package.nls.*` — часть claude-11).
- `repository` с `directory` для монорепо, `license: MIT`, `displayName`, `description`, `categories` — заполнены корректно.
- **`.vscodeignore`** — лишнего в `.vsix` не попадает и нужное не выпадает: `vsce ls` и `unzip -l` дают ровно `package.json`, `README.md`, `LICENSE.txt`, `l10n/bundle.l10n.json`, `dist/extension.js`. Исходники, `webview/**`, tsconfig, `esbuild.mjs`, `**/*.ts`, `**/*.map`, `node_modules`, `*.vsix` исключены. Структурный риск (список исключений включает всё новое по умолчанию, и это ничем не проверяется) — claude-09; отсутствие CHANGELOG в пакете — claude-19; безусловное исключение `.map` — claude-20.

**Приоритет 5 (сборка).** Находка: claude-20. Чисто:
- Расхождение `target: node18` при `engines.node: ">=26"` — намеренное и корректное: 1.85 соответствует Node 18 рантайма редактора, расхождение объяснено комментарием в `esbuild.mjs`, в README пакета и отдельным разделом `AGENTS.md`. Обратная ошибка (собрать под Node 26) исключена запретом в каноне.
- `format: 'cjs'` + `platform: 'node'` + `external: ['vscode']` + `bundle: true` — корректный набор для расширения VS Code: `vscode` предоставляется рантаймом и не должен попадать в бандл (в `.vsix` его и нет), CJS — формат, ожидаемый загрузчиком расширений для точки входа `main`.
- **Что будет при поднятии `engines.vscode`** (прямой ответ на вопрос брифа): `target: node18` останется рабочим — он задаёт нижнюю границу синтаксиса, а не верхнюю, поэтому бандл продолжит исполняться в более новом Node редактора; поднимать его вместе с планкой не обязательно и не срочно. Риск при поднятии планки лежит в другом месте и он не покрыт: значение `target` связано с `engines.vscode` только комментарием, `@types/vscode` — только точным пином, и ни одна проверка не сверяет эти три значения между собой. Поднятие `engines.vscode` без поднятия `@types/vscode` оставит typecheck на старой планке молча (обратная сторона claude-08).
- `entryPoints`/`outfile` согласованы с `main` манифеста (`./dist/extension.js`), `dist/` в `.gitignore` и в `.prettierignore`, сборка воспроизводится.

**Приоритет 6 (симлинки).** Находка: claude-17 (размещение предупреждения). Чисто:
- `git ls-files -s CLAUDE.md` → `120000 47dc3e3d…` — DoD 01-C по режиму выполнен, копии файла в индексе нет.
- `.gitattributes` — обработан правильно и с пониманием механизма: `CLAUDE.md -text` исключает файл из eol-конверсии именно на случай, когда он материализуется текстом с путём цели; `* text=auto`; `*.vsix binary`.
- **`vsce package`** — симлинк `packages/projects-tree/LICENSE → ../../LICENSE` разыменовывается: в `.vsix` лежит `extension/LICENSE.txt` размером 1076 байт, то есть содержимое лицензии, а не 13-байтная ссылка. Поведение упаковщика подтверждено `unzip -l`.
- **Клонирование в CI** — безопасно: `actions/checkout` на `ubuntu-latest` создаёт настоящие симлинки, `pnpm --filter projects-tree package` в CI получит тот же разыменованный LICENSE.
- **Windows** — единственная реальная деградация (`CLAUDE.md` придёт текстом с путём цели) описана в `docs/architecture.md` подробно и корректно, включая необходимость `core.symlinks` до чекаута и права на создание symlink в ОС. Замечание только к месту размещения (claude-17). Для `packages/projects-tree/LICENSE` последствие на Windows то же и не описано, но оно безвредно для тулинга и заметно при упаковке.

**Приоритет 7 (`AGENTS.md` как рабочий документ).** Находка: claude-11 (правило, противоречащее реализации). Чисто:
- Правило «`src/projects/**` не импортирует `vscode`, это машинно проверяемая граница; не ослабляй правило, чтобы протащить импорт» — сформулировано однозначно и исполнимо. Оговорка: его машинная часть сейчас не работает (claude-01), то есть правило корректно как предписание и не подкреплено как проверка.
- Правило «класс проверок добавляет тот пакет, что его вводит; не добавляй проверку в CI, не заведя её в `pnpm check`» — исполнимо, проверяемо и уже сработало бы на claude-09.
- Правило про `api-facts.md` («ни одно решение не опирается на утверждение об API без дословной цитаты источника строкой в файле») — однозначно и исполнимо; двусмысленности «ссылка без цитаты не годится» в формулировке нет.
- Правила про язык кода и коммитов, про Conventional Commits со scope, про соотношение Node тулинга и рантайма — исполнимы; последнее подкреплено реализацией (`target: node18`).
- Правило «правь план только чтобы зафиксировать сознательно изменённое решение, а не чтобы подогнать план под написанный код» — однозначно; замечу, что claude-14 (отклонение по `activationEvents`) — как раз случай, требующий такой фиксации, и она не сделана.
- Формой документ соответствует своему назначению: только действующие правила, обоснования вынесены в `docs/architecture.md`, история отсутствует, объём небольшой.

**Приоритет 8 (соответствие плану, DoD 01-A..01-E).** Разбор по пакетам:
- **01-A — выполнен.** `pnpm install` и `pnpm -r typecheck` проходят; webview виден в `pnpm -r list` (3 проекта). Все перечисленные флаги strict присутствуют в `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`). Node 26 в `engines`, `.nvmrc`, в CI через `node-version-file`. Общих пакетов заранее не заведено — как и предписано. Замечание к `pnpm-workspace.yaml` — claude-16.
- **01-B — выполнен частично.** `pnpm check` проходит и содержит все семь объявленных шагов в объявленном порядке; неотформатированный файл его роняет (проверено). Не выполнено требование «для **каждого** правила dependency-cruiser намеренное нарушение роняет проверку»: для пяти из шести правил `no-sibling-internals` нарушителя не существует (claude-03), а два правила не срабатывают на реальном коде вообще (claude-01). Три таблицы отложенных проверок (`schema:check`/02, `l10n:check`/03, `build:webview`/06) в план записаны и в `check` намеренно не добавлены — верно. Все заявленные плагины ESLint подключены, правила против `console` и `child_process` заданы.
- **01-C — выполнен, с одним отклонением по размещению.** `AGENTS.md`, симлинк mode 120000, `.gitattributes`, `docs/architecture.md` — на месте. Требование DoD «в README сказано про Windows» выполнено не в README (claude-17). Содержательное расхождение канона с реализацией — claude-11.
- **01-D — выполнен частично.** Манифест, `esbuild.mjs`, `.vscodeignore`, README пакета, CHANGELOG, LICENSE — на месте; `.vsix` собирается одной командой. **Не сделано:** проверка состава через `vsce ls` в CI (claude-09), Changesets для версий и CHANGELOG (claude-04). **Отклонение от плана:** `activationEvents: []` вместо «по обоим id view» (claude-14); `contributes.jsonValidation` ссылается на несуществующий файл (claude-07). **DoD не подтверждён полностью:** заявлена установка в VS Code 1.136.0, тогда как DoD требует установку **и в VS Code, и в Cursor** («проверка совместимости идёт здесь, а не в конце») — про Cursor в материале нет ни подтверждения, ни отметки об отказе от требования; кроме того «дерево-заглушка видна» подтвердить невозможно, поскольку вкладов view нет и расширение не активируется (claude-14). Проверить установку в редакторе я не могу — это вне доступных мне средств.
- **01-E — выполнен частично.** Все три workflow и `dependabot.yml` на месте, `actionlint` чист, `permissions` минимальны, `--frozen-lockfile` везде, гейт публикации через `env` работает и пропуск отчитывается явно. Джоба `integration` намеренно отложена на этап 03 — верно. **DoD не подтверждён:** «тестовый тег в форке даёт релиз с `.vsix`» и «при наличии секрета в форке публикация действительно вызывается» — прогоны в форке проверить локально невозможно; при этом claude-04 предсказывает, что первый же реальный тег даст артефакт версии `0.0.0`, то есть этот DoD, вероятно, не был прогнан. Отдельно не выполнено требование «`publish.yml` прогоняется в форке в обоих состояниях» из тестового плана этапа.

Не проверялось (вне доступных средств, отмечаю честно, а не как чистое): установка `.vsix` в VS Code и в Cursor и видимость UI; фактические прогоны workflow в GitHub Actions и в форке; поведение чекаута на Windows; доступность/занятость publisher `fractalizer` в Marketplace и Open VSX.

---

## Что ломалось при проверке и было восстановлено

Все правки делались только для проверки исполнением и откатывались; ни один файл материала не оставлен изменённым.

- `.dependency-cruiser.mjs` — дважды: (а) генерация попарных правил `no-sibling-internals` заменена на одну пару; (б) удалено исключение `pathNot` для `fileSystem.ts`. Восстановлен из копии, `md5` совпадает с исходным (`c8f47b13952fa6ac1f64af0cced85da5`).
- `packages/projects-tree/src/extension.ts` — дважды переписан, чтобы сделать файл-нарушитель достижимым для knip. Восстановлен из копии.
- Временно созданы и удалены: `packages/projects-tree/src/{shared/fs.ts, projects/**, editor/**, typed-bait.ts, direct-violation.ts}`, `packages/projects-tree/webview/src/{leak.ts, typed-bait.ts, direct-violation.ts}`, `tools/{orphan.ts, orphan.mjs, typed-violation.ts}`.
- `docs/architecture.md` и `.github/dependabot.yml` — временно дописан неформатированный хвост, затем усечён до исходного содержимого.
- **`package.json` и `pnpm-lock.yaml`** — для проверки knip добавлялась фиктивная devDependency `left-pad`. `package.json` восстановлен из копии. `pnpm exec knip` при этом сам выполнил установку и внёс `left-pad` в лок-файл **тремя** блоками; `pnpm install --lockfile-only` их не вычистил, поэтому три блока удалены вручную. Итог сверен с копией лок-файла, снятой до правки: расхождение — ровно строки `left-pad` и одна пустая строка, ничего иного не изменено. `pnpm install --frozen-lockfile` после этого проходит.

Финальное состояние: `pnpm check` → **exit 0**; `git status --short` без неотслеженных файлов показывает только предсуществующие `A CLAUDE.md` и `M README.md` (состояние ветки до моей работы, я их не касался).

---

## Refuted

- `claude-r01 | Отсутствие `--frozen-lockfile` при установке в workflow | Отклонено: бриф называл это возможным дефектом, но флаг присутствует во всех трёх workflow (`ci.yml:27`, `release.yml:30`, `publish.yml:32`), и локальный `pnpm install --frozen-lockfile` проходит без пересборки лок-файла.
- `claude-r02 | Гейт публикации через `env.*` открыл новую дыру в логике пропуска | Отклонено по существу логики: `if: env.VSCE_PAT != ''` вычисляется корректно, `continue-on-error` отсутствует, шаг «Report skipped publishers» отчитывается о пропуске явно, ложного «зелёного при провале публикации» нет. Дыра от этого исправления есть, но в другом — в области видимости токенов, и оформлена отдельной находкой claude-05, а не как дефект гейта.
- `claude-r03 | `pull_request` в `ci.yml` как риск исполнения кода форка с доступом к секретам | Отклонено: триггер `pull_request`, а не `pull_request_target`, поэтому прогон идёт без секретов репозитория; `permissions: contents: read`, `secrets` в workflow не используется. Остаётся только удвоение прогонов — claude-18.
- `claude-r04 | `type-only` импорты проходят мимо правил границ | Отклонено: `tsPreCompilationDeps: true` включён, depcruise видит type-only зависимости и помечает их (`dependencyTypes: ['npm-dev','type-only','import']`). Причина, по которой импорт `vscode` из ядра не ловится, к type-only не относится — это резолв в путь `@types/vscode` (claude-01), и обычный value-импорт не ловится точно так же.
- `claude-r05 | `tools/architecture-fixtures/**` исключены из проверок настолько широко, что фикстуры могли деградировать незамеченными | Отклонено: исключения (в `eslint.config.mjs`, `knip.json`, `vitest.config.ts`, `tsconfig.json`) обоснованы природой фикстур, а Prettier их наоборот проверяет. Деградация фикстур ловится самим `depcruise:negative` — он краснеет, если фикстура перестала нарушать правило. Реальный дефект здесь не в исключениях, а в неполноте набора фикстур (claude-03) и в их контексте резолва (claude-01).
