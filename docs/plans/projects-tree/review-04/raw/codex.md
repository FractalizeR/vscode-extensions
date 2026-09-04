Итог: подтверждены 2 HIGH, 8 MEDIUM и 2 LOW. Наиболее опасны публикация через незакреплённый `ovsx` с доступом к обоим PAT и отсутствие связи между git-тегом и версией VSIX.

## Находки

### codex-01

- **id**: codex-01
- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: security
- **title**: Незакреплённый `ovsx` исполняется с обоими publish-токенами
- **mechanism**: `pnpm dlx ovsx` загружает актуальную версию пакета из npm вне lockfile. Оба PAT объявлены на уровне job, поэтому этот динамически полученный код получает также не предназначенный ему `VSCE_PAT`.
- **trigger**: воспроизводится в нормальной работе — push тега `v*` или ручной запуск при настроенном `OVSX_PAT`
- **in_scope**: да
- **anchor**: `.github/workflows/publish.yml`: job `publish`, job-level `env`, шаг `Publish to Open VSX Registry`
- **evidence**:
  - `.github/workflows/publish.yml:18-20`
    ```yaml
    env:
      VSCE_PAT: ${{ secrets.VSCE_PAT }}
      OVSX_PAT: ${{ secrets.OVSX_PAT }}
    ```
  - `.github/workflows/publish.yml:50-52`
    ```yaml
    - name: Publish to Open VSX Registry
      if: env.OVSX_PAT != ''
      run: pnpm dlx ovsx publish "${{ steps.vsix.outputs.path }}" --pat "$OVSX_PAT"
    ```
- **verification**: confirmed
- **verification_note**: `ovsx` отсутствует в `package.json` и `pnpm-lock.yaml`; `actionlint` проходит, поскольку не анализирует supply-chain и область секретов
- **fix_direction**: закрепить проверенную версию publish-клиента в lockfile и передавать каждый PAT только соответствующему шагу

### codex-02

- **id**: codex-02
- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Релизный тег не связан с версией VSIX
- **mechanism**: workflows принимают любой тег `v*`, но манифест остаётся `0.0.0`; заявленного Changesets-механизма и проверки соответствия версии тегу нет. Релиз `v0.1.0` получит VSIX версии `0.0.0`, а повторная публикация той же версии будет отвергнута registry.
- **trigger**: воспроизводится в нормальной работе — первый релиз с тегом, отличным от `v0.0.0`
- **in_scope**: да
- **anchor**: контракт 01-D «Changesets для версий и CHANGELOG» и release/publish-контур
- **evidence**:
  - `docs/plans/projects-tree/01-monorepo-and-tooling.md:128-129`
    ```markdown
    - проверка состава пакета через `vsce ls` в CI: неожиданный файл — ошибка;
    - Changesets для версий и CHANGELOG.
    ```
  - `packages/projects-tree/package.json:2-4`
    ```json
    "name": "projects-tree",
    "version": "0.0.0",
    "private": true,
    ```
  - `.github/workflows/release.yml:4-6`
    ```yaml
    push:
      tags:
        - 'v*'
    ```
- **verification**: confirmed
- **verification_note**: `rg -i 'changeset|@changesets' package.json pnpm-lock.yaml .github packages` не нашёл механизма версионирования; упакованный VSIX содержит версию `0.0.0`
- **fix_direction**: ввести единый процесс версионирования и до публикации проверять соответствие версии расширения тегу

### codex-03

- **id**: codex-03
- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Негативная проверка покрывает только одну из шести sibling-пар
- **mechanism**: шесть направленных правил сворачиваются к одному concept, а единственная фикстура возбуждает только `discovery->classification`. Поломка или удаление остальных пяти правил оставит `depcruise:negative` зелёным.
- **trigger**: воспроизводится в нормальной работе — изменение генерации пар, при котором сохраняется хотя бы одна проверяемая пара
- **in_scope**: да
- **anchor**: `tools/depcruise-negative.mjs:26-28`
- **evidence**:
  ```js
  function ruleConcept(ruleName) {
    return ruleName.split(':', 1)[0];
  }
  ```
- **verification**: confirmed
- **verification_note**: `pnpm depcruise:negative` зелёный; чтение JSON-отчёта и фикстуры показало единственное срабатывание `no-sibling-internals:discovery->classification`
- **fix_direction**: проверять полный ожидаемый набор направленных пар, а не только общий префикс concept

### codex-04

- **id**: codex-04
- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: `webview-is-isolated` пропускает импорт точки входа расширения
- **mechanism**: правило запрещает только `src/projects/**` и `src/editor/**`. Webview может импортировать `src/extension.ts` или будущий runtime-файл непосредственно под `src/`, хотя план запрещает весь код расширения, кроме типов протокола.
- **trigger**: только на рукотворном входе — такой импорт добавляет разработчик
- **in_scope**: да
- **anchor**: контракт `webview-is-isolated`
- **evidence**:
  - `docs/plans/projects-tree/01-monorepo-and-tooling.md:76-77`
    ```markdown
    - `webview-is-isolated`: webview не импортирует ни `vscode`, ни код расширения, кроме типов
      протокола;
    ```
  - `.dependency-cruiser.mjs:59-63`
    ```js
    name: 'webview-is-isolated',
    severity: 'error',
    from: { path: '(^|/)webview/src/' },
    to: { path: '^vscode$|(^|/)src/(projects|editor)/' },
    ```
- **verification**: confirmed
- **verification_note**: regex не совпадает с `packages/projects-tree/src/extension.ts`; существующая негативная фикстура эту форму не проверяет
- **fix_direction**: запретить webview весь runtime extension package с отдельным узким разрешением протокольных типов

### codex-05

- **id**: codex-05
- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: tests
- **title**: CI не проверяет allowlist содержимого VSIX
- **mechanism**: CI собирает и загружает любой успешно созданный VSIX, но не запускает заявленный `vsce ls` и не сравнивает результат с ожидаемым списком. Ошибка `.vscodeignore` пройдёт зелёной.
- **trigger**: воспроизводится в нормальной работе — добавление нового не исключённого файла
- **in_scope**: да
- **anchor**: контракт 01-D «проверка состава пакета через `vsce ls` в CI»
- **evidence**:
  - `docs/plans/projects-tree/01-monorepo-and-tooling.md:127-129`
    ```markdown
    - `@vscode/vsce package` собирает `.vsix`; `.vscodeignore` исключает исходники, тесты, конфиги;
    - проверка состава пакета через `vsce ls` в CI: неожиданный файл — ошибка;
    - Changesets для версий и CHANGELOG.
    ```
  - `.github/workflows/ci.yml:38-42`
    ```yaml
    - name: Package projects-tree
      run: pnpm --filter projects-tree package
    - name: Upload .vsix artifact
      uses: actions/upload-artifact@v4
    ```
- **verification**: confirmed
- **verification_note**: в `ci.yml` отсутствует проверка списка; текущий VSIX чист, но это свойство CI не фиксирует
- **fix_direction**: до загрузки артефакта машинно сравнивать полный состав VSIX с утверждённым allowlist

### codex-06

- **id**: codex-06
- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: Манифест регистрирует отсутствующую JSON Schema
- **mechanism**: `jsonValidation` указывает на ресурс, которого нет ни в исходном пакете, ни в VSIX. `vsce` это допускает, но VS Code не сможет загрузить схему для совпавшего файла.
- **trigger**: воспроизводится в нормальной работе после появления `projects-tree.rules.json`; сейчас — при создании такого файла вручную
- **in_scope**: да
- **anchor**: `packages/projects-tree/package.json:34-38`
- **evidence**:
  ```json
  "jsonValidation": [{
    "fileMatch": "projects-tree.rules.json",
    "url": "./schemas/projects-tree.rules.schema.json"
  }]
  ```
- **verification**: confirmed
- **verification_note**: `find` не обнаружил схему; `unzip -l projects-tree-0.0.0.vsix` также подтвердил её отсутствие
- **fix_direction**: не публиковать contribution до появления ресурса либо поставлять и проверять схему атомарно

### codex-07

- **id**: codex-07
- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Корневая команда `pnpm package` отсутствует
- **mechanism**: DoD обещает сборку VSIX одной корневой командой, но `package` объявлен только внутри workspace расширения; CI вынужден знать конкретный фильтр.
- **trigger**: воспроизводится в нормальной работе — запуск указанной в DoD команды из корня
- **in_scope**: да
- **anchor**: контракт 01-D «`pnpm package` даёт устанавливаемый `.vsix`»
- **evidence**:
  - `docs/plans/projects-tree/01-monorepo-and-tooling.md:131-132`
    ```markdown
    DoD: `pnpm package` даёт устанавливаемый `.vsix`; **он установлен в VS Code и в Cursor
    ```
  - `package.json:16-18`
    ```json
    "knip": "knip",
    "test": "vitest run",
    "check": "pnpm run format:check && ..."
    ```
- **verification**: confirmed
- **verification_note**: `pnpm run package` из корня завершился `ERR_PNPM_NO_SCRIPT: Missing script: package`
- **fix_direction**: закрепить единый корневой entry point упаковки

### codex-08

- **id**: codex-08
- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Реализация не может выполнить DoD о видимой дерево-заглушке
- **mechanism**: манифест не contributes ни одного view, `activationEvents` пуст, а `activate` ничего не регистрирует. Установленное расширение физически не может показать заявленную дерево-заглушку.
- **trigger**: воспроизводится в нормальной работе — установка и открытие расширения
- **in_scope**: да
- **anchor**: контракт 01-D: activation по двум view id и видимая дерево-заглушка
- **evidence**:
  - `packages/projects-tree/package.json:32-34`
    ```json
    "activationEvents": [],
    "contributes": {
      "jsonValidation": [
    ```
  - `packages/projects-tree/src/extension.ts:3-5`
    ```ts
    export function activate(_context: vscode.ExtensionContext): void {
      // Intentionally empty: no contributions registered yet.
    }
    ```
- **verification**: confirmed
- **verification_note**: в полном манифесте отсутствуют `views`, `viewsContainers` и команды; README расширения также говорит `No views or commands are contributed yet`
- **fix_direction**: согласовать границу этапов: реализовать минимальный contribution либо явно изменить контракт этапа отдельным решением

### codex-09

- **id**: codex-09
- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Полная валидация постоянно исключает docs и workspace-конфиг
- **mechanism**: временное владение файлами пакетами работ закреплено в постоянном `.prettierignore`. Последующие неформатированные изменения планов, архитектурной документации и `pnpm-workspace.yaml` не роняют `pnpm check`.
- **trigger**: воспроизводится в нормальной работе — последующая правка исключённого файла
- **in_scope**: да
- **anchor**: `.prettierignore:7-11`
- **evidence**:
  ```text
  # Владелец docs/** — пакет 01-C, форматирование планов вне области этого пакета.
  docs/
  # pnpm-workspace.yaml — владелец 01-A, уже принят; правится только тем пакетом
  pnpm-workspace.yaml
  ```
- **verification**: confirmed
- **verification_note**: пути исключены из `prettier --check .`; отдельная команда `pnpm exec prettier --check docs pnpm-workspace.yaml` сейчас зелёная, но основная проверка их не охраняет
- **fix_direction**: убрать временные ownership-исключения из постоянной конфигурации

### codex-10

- **id**: codex-10
- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Package LICENSE зависит от поддержки symlink на Windows
- **mechanism**: при checkout с `core.symlinks=false` Git материализует symlink как обычный файл с текстом `../../LICENSE`. Локальная Windows-упаковка может поэтому положить в `LICENSE.txt` путь цели вместо лицензии; Linux CI этого не обнаружит.
- **trigger**: воспроизводится в нормальной работе — стандартный Windows checkout и локальная упаковка
- **in_scope**: да
- **anchor**: контракт кроссплатформенной упаковки `packages/projects-tree/LICENSE`
- **evidence**:
  - файловая точка: `packages/projects-tree/LICENSE` → `../../LICENSE`
  - `docs/architecture.md:40-44`
    ```markdown
    Git на Windows не создаёт файловую ссылку при чекауте: `CLAUDE.md` материализуется как обычный
    текстовый файл, содержащий строку `AGENTS.md` — путь цели, а не её содержимое.
    ```
  - `.gitattributes:4-8` отдельно обрабатывает только `CLAUDE.md`
- **verification**: unverifiable
- **verification_note**: на macOS `vsce` корректно разыменовал ссылку в `LICENSE.txt` размером 1076 байт; Windows checkout/package в текущем окружении не выполнялся
- **fix_direction**: выбрать кроссплатформенное представление лицензии либо добавить проверку фактического содержимого на Windows

### codex-11

- **id**: codex-11
- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: reliability
- **title**: Правила `AGENTS.md` двусмысленны для integration tests
- **mechanism**: абсолютное правило требует включать любую CI/package-script проверку в `pnpm check`, а следующая инструкция требует держать `test:integration` только в CI. Будущий агент вынужден самостоятельно решать, является ли вторая фраза исключением.
- **trigger**: воспроизводится в нормальной работе — реализация integration tests этапа 03
- **in_scope**: да
- **anchor**: рабочий контракт Validation в `AGENTS.md`
- **evidence**:
  ```markdown
  Do not add a check to CI or to a package script without also wiring it into `pnpm check`
  ...
  Integration tests (`@vscode/test-cli`, script `test:integration`) are not part of `pnpm check` —
  they require a running editor and run only in CI.
  ```
- **verification**: confirmed
- **verification_note**: взаимоисключающие формулировки находятся подряд в `AGENTS.md:38-43`; план 01-E подтверждает отдельную CI job
- **fix_direction**: явно сформулировать исключение для editor-dependent проверок

### codex-12

- **id**: codex-12
- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: reliability
- **title**: Windows-ограничение `CLAUDE.md` отсутствует в README
- **mechanism**: предупреждение находится только в архитектурном документе. Windows-пользователь, начинающий с README, не узнает, что без symlink support `CLAUDE.md` превращается в текст `AGENTS.md`.
- **trigger**: воспроизводится в нормальной работе — стандартный Windows clone
- **in_scope**: да
- **anchor**: DoD пакета 01-C
- **evidence**:
  - `docs/plans/projects-tree/01-monorepo-and-tooling.md:97-99`
    ```markdown
    в `.gitattributes`
    зафиксировано поведение, и в README сказано, что на Windows без `core.symlinks=true` файл придёт
    текстом
    ```
  - `README.md:1-3`
    ```markdown
    # vscode-extensions

    My extensions for VS Code
    ```
- **verification**: confirmed
- **verification_note**: `rg 'core.symlinks|Windows' README.md packages/projects-tree/README.md` не нашёл упоминаний
- **fix_direction**: добавить в README краткое предупреждение о Windows checkout

## Отклонённые находки

- codex-R01 | В CI отсутствует `--frozen-lockfile` | refuted: флаг присутствует во всех трёх workflows.
- codex-R02 | Fork PR получает publish-секреты или write-token | refuted: `ci.yml` имеет только `contents: read` и не обращается к secrets.
- codex-R03 | Отсутствующая секция CHANGELOG создаёт пустой Release | refuted: строки 48–50 формируют generic note.
- codex-R04 | `target: node18` ошибочно расходится с Node 26 | refuted: Node 26 относится к toolchain, Node 18 — к runtime нижней границы VS Code.
- codex-R05 | `.vscodeignore` сейчас включает лишнее или исключает runtime | refuted: фактический VSIX содержит только manifest/XML, `package.json`, README, LICENSE, l10n и `dist/extension.js`.
- codex-R06 | Точный `@types/vscode` допускает API новее нижней границы | refuted: версия закреплена на `1.85.0`.
- codex-R07 | Smoke test маскирует discovery будущих тестов | refuted: glob Vitest покрывает оба package `src/**` и `tools/**`.
- codex-R08 | `allowBuilds` содержит посторонние application-зависимости | refuted: записи относятся к текущему build/tooling graph.

## Coverage

Проверены все 8 приоритетов. Полностью чистым без находок признан только приоритет 5 — сборка:

- `esbuild.mjs`: `platform: node`, `target: node18`, `format: cjs`, `external: ['vscode']`, dev sourcemap и prod minify согласованы.
- Поднятие `engines.vscode` само по себе не требует менять target: это нужно только при осознанном использовании возможностей более нового Node runtime.

Остальные приоритеты покрыты находками выше:

- 1 — `pnpm check`, configs ESLint/TypeScript/Knip/Vitest, все depcruise rules и fixtures.
- 2 — `actionlint 1.7.12`, permissions, fork PR, frozen install, publish secrets, release fallback.
- 3 — оба `package.json`, все tsconfig, `.prettierignore`, workspace и `allowBuilds`.
- 4 — полный manifest и фактический VSIX.
- 6 — оба symlink, `.gitattributes`, macOS VSIX и Windows-механизм.
- 7 — весь `AGENTS.md`.
- 8 — DoD 01-A…01-E.

Команды:

- `pnpm check` — финальный чистый прогон exit 0, все 7 стадий прошли.
- `actionlint .github/workflows/{ci,release,publish}.yml` — `[]`.
- `pnpm exec vsce ls --tree` и `unzip -l` — текущий VSIX чист.
- `pnpm run package` из корня — подтверждён `ERR_PNPM_NO_SCRIPT`.
- `pnpm exec prettier --check docs pnpm-workspace.yaml` — текущие исключённые файлы отформатированы.
- `git status --short` после ревью совпадает с исходным составом; материал не изменён.

По DoD: 01-A выполнен; 01-B расходится по полноте negative fixtures и formatting scope; 01-C — по README; 01-D — по корневой упаковке, allowlist VSIX, Changesets, schema и tree placeholder; 01-E — по границе publish credentials.

Для одного расширения-заглушки преждевременны отдельный webview workspace, реальная publish job, Knip, commit hooks и полный fixture harness архитектурных правил. Это не отдельные дефекты: они предписаны планом, но уже создали заметную maintenance/supply-chain поверхность до появления пользовательской функции.

Ревью организовано по процедурам [dvizh-vr-review](/Users/fractalizer/.codex/plugins/cache/dvizh-marketplace/dvizh-vr-review/6.0.1/skills/review/SKILL.md) и [workflow review](/Users/fractalizer/.codex/plugins/cache/dvizh-marketplace/dvizh-vr-workflow/3.3.1/skills/review/SKILL.md): один reviewer получил материал целиком, после чего находки были точечно перепроверены командами и чтением контрактов.
