# Находки codex — этап 01 (round 04)

## codex-01

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: security
- **title**: Незакреплённый `ovsx` исполняется с обоими publish-токенами
- **mechanism**: `pnpm dlx ovsx publish` тянет актуальную версию пакета из npm вне lockfile (не pinned, нет integrity-проверки). Оба PAT (`VSCE_PAT`, `OVSX_PAT`) объявлены на уровне job в `env`, поэтому этот динамически полученный код на этапе publish получает доступ и к `VSCE_PAT`, которому он не должен быть виден.
- **trigger**: воспроизводится в нормальной работе — push тега `v*` или `workflow_dispatch` при настроенном `OVSX_PAT`
- **in_scope**: да
- **anchor**: `.github/workflows/publish.yml:18-20,50-52`
- **evidence**:
  ```yaml
  env:
    VSCE_PAT: ${{ secrets.VSCE_PAT }}
    OVSX_PAT: ${{ secrets.OVSX_PAT }}
  ...
  - name: Publish to Open VSX Registry
    if: env.OVSX_PAT != ''
    run: pnpm dlx ovsx publish "${{ steps.vsix.outputs.path }}" --pat "$OVSX_PAT"
  ```
- **verification**: confirmed
- **verification_note**: перепроверено чтением `.github/workflows/publish.yml` — `ovsx` действительно отсутствует в `package.json`/`pnpm-lock.yaml` (только через `pnpm dlx`), оба PAT объявлены в общем job-level `env`, доступном всем шагам job, включая шаг с `ovsx`.
- **fix_direction**: закрепить проверенную версию publish-клиента (в devDependencies с lockfile-записью либо через явный pinned `pnpm dlx ovsx@<version>`) и/или изолировать шаги с разными секретами так, чтобы код, полученный вне lockfile, не видел чужой PAT.

## codex-02

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Релизный тег не связан с версией VSIX
- **mechanism**: `release.yml`/`publish.yml` принимают любой тег `v*`, но манифест `packages/projects-tree/package.json` остаётся `"version": "0.0.0"`, заявленный в плане Changesets-механизм не реализован, проверки соответствия версии тегу нет. Первый релиз с тегом, отличным от `v0.0.0`, соберёт и опубликует VSIX версии `0.0.0`, а повторная публикация той же версии будет отвергнута registry.
- **trigger**: воспроизводится в нормальной работе — первый релизный тег, отличный от `v0.0.0`
- **in_scope**: да
- **anchor**: контракт 01-D «Changesets для версий и CHANGELOG» (`docs/plans/projects-tree/01-monorepo-and-tooling.md:128-129`) против `packages/projects-tree/package.json:2-4` и `.github/workflows/release.yml:4-6`
- **evidence**:
  ```json
  "name": "projects-tree",
  "version": "0.0.0",
  "private": true,
  ```
  ```yaml
  push:
    tags:
      - 'v*'
  ```
- **verification**: confirmed
- **verification_note**: перепроверено — в репозитории нет `changeset`/`@changesets` ни в package.json, ни в pnpm-lock.yaml, ни в `.github/`; `packages/projects-tree/package.json` содержит `version: 0.0.0` без механизма синхронизации с git-тегом.
- **fix_direction**: ввести единый процесс версионирования (Changesets или эквивалент) и шаг в release/publish workflow, который до публикации сверяет версию манифеста с тегом.

## codex-03

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Негативная проверка покрывает только одну из шести sibling-пар
- **mechanism**: `tools/depcruise-negative.mjs` сворачивает шесть направленных попарных правил `no-sibling-internals` к одному concept через `ruleName.split(':', 1)[0]`, а единственная фикстура возбуждает лишь пару `discovery->classification`. Поломка или удаление любого из остальных пяти направленных правил оставит `pnpm depcruise:negative` зелёным.
- **trigger**: воспроизводится в нормальной работе — изменение генерации/состава правил, при котором сохраняется хотя бы одна проверяемая пара
- **in_scope**: да
- **anchor**: `tools/depcruise-negative.mjs:26-28`
- **evidence**:
  ```js
  function ruleConcept(ruleName) {
    return ruleName.split(':', 1)[0];
  }
  ```
- **verification**: confirmed
- **verification_note**: подтверждено чтением `tools/depcruise-negative.mjs` и `tools/architecture-fixtures/**` — фикстура и логика группировки покрывают только один concept вместо всех шести направленных пар.
- **fix_direction**: проверять полный ожидаемый набор направленных пар (все шесть), а не сворачивать их к общему префиксу.

## codex-04

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: `webview-is-isolated` пропускает импорт точки входа расширения
- **mechanism**: правило dependency-cruiser запрещает webview импортировать только `src/projects/**` и `src/editor/**`, но не сам `src/extension.ts` (или другой будущий файл непосредственно под `src/`). План требует изоляции webview от всего кода расширения, кроме типов протокола — regex правила это не покрывает.
- **trigger**: только на рукотворном входе — такой импорт добавляет разработчик
- **in_scope**: да
- **anchor**: контракт `webview-is-isolated` (`docs/plans/projects-tree/01-monorepo-and-tooling.md:76-77`) против `.dependency-cruiser.mjs:59-63`
- **evidence**:
  ```js
  name: 'webview-is-isolated',
  severity: 'error',
  from: { path: '(^|/)webview/src/' },
  to: { path: '^vscode$|(^|/)src/(projects|editor)/' },
  ```
- **verification**: confirmed
- **verification_note**: перепроверено чтением `.dependency-cruiser.mjs` — regex `to.path` действительно не совпадает с `packages/projects-tree/src/extension.ts` (только `projects|editor` подпапки под `src/`).
- **fix_direction**: расширить правило до запрета всего runtime-кода extension-пакета с точечным разрешением только для протокольных типов.

## codex-05

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: tests
- **title**: CI не проверяет allowlist содержимого VSIX
- **mechanism**: `ci.yml` собирает и загружает как артефакт любой успешно созданный VSIX, но не запускает заявленный планом `vsce ls` и не сравнивает состав с ожидаемым списком. Ошибка в `.vscodeignore` (например, случайное включение исходников) пройдёт CI зелёной.
- **trigger**: воспроизводится в нормальной работе — добавление в пакет файла, не исключённого `.vscodeignore`
- **in_scope**: да
- **anchor**: контракт 01-D «проверка состава пакета через `vsce ls` в CI» (`docs/plans/projects-tree/01-monorepo-and-tooling.md:127-129`) против `.github/workflows/ci.yml:38-42`
- **evidence**:
  ```yaml
  - name: Package projects-tree
    run: pnpm --filter projects-tree package
  - name: Upload .vsix artifact
    uses: actions/upload-artifact@v4
  ```
- **verification**: confirmed
- **verification_note**: перепроверено чтением `.github/workflows/ci.yml` целиком — шага `vsce ls` или сравнения состава с allowlist в файле нет.
- **fix_direction**: добавить в CI шаг, машинно сравнивающий полный список файлов внутри VSIX с утверждённым allowlist, до загрузки артефакта.

## codex-06

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: Манифест регистрирует отсутствующую JSON Schema
- **mechanism**: `contributes.jsonValidation` ссылается на `./schemas/projects-tree.rules.schema.json`, которого нет ни в исходниках, ни в собранном VSIX. `vsce package` не считает это ошибкой, но VS Code не сможет загрузить схему для файлов, совпавших с `fileMatch`.
- **trigger**: воспроизводится в нормальной работе — как только пользователь создаёт файл `projects-tree.rules.json` (для этого расширение вообще не должно быть активировано специально, достаточно наличия файла в открытой папке)
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
- **verification_note**: перепроверено — `find packages/projects-tree -iname '*schema*'` ничего не находит, файла `schemas/projects-tree.rules.schema.json` в дереве нет.
- **fix_direction**: не публиковать contribution `jsonValidation` до появления файла схемы, либо добавить схему и её проверку в CI атомарно вместе с манифестом.

## codex-07

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Корневая команда `pnpm package` отсутствует
- **mechanism**: DoD пакета 01-D обещает сборку VSIX единой корневой командой `pnpm package`, но скрипт `package` объявлен только внутри `packages/projects-tree/package.json`. В корневом `package.json` такого скрипта нет — CI и разработчики вынуждены знать точный `--filter`.
- **trigger**: воспроизводится в нормальной работе — попытка выполнить команду из DoD дословно
- **in_scope**: да
- **anchor**: контракт 01-D «`pnpm package` даёт устанавливаемый `.vsix`» (`docs/plans/projects-tree/01-monorepo-and-tooling.md:131-132`) против корневого `package.json` (секция `scripts`)
- **evidence**:
  ```json
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json && pnpm -r run typecheck",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "depcruise": "...",
    "depcruise:negative": "node tools/depcruise-negative.mjs",
    "knip": "knip",
    "test": "vitest run",
    "check": "..."
  }
  ```
- **verification**: confirmed
- **verification_note**: перепроверено чтением корневого `package.json` целиком — скрипта `package` в разделе `scripts` нет; он есть только в `packages/projects-tree/package.json` (`"package": "pnpm run build:prod && vsce package --no-dependencies"`), и вызывается в `publish.yml`/`ci.yml` через `pnpm --filter projects-tree package`, а не через голый `pnpm package` из корня.
- **fix_direction**: добавить в корневой `package.json` скрипт `package`, делегирующий на нужный workspace, либо скорректировать формулировку DoD.

## codex-08

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Реализация не может выполнить DoD о видимой дерево-заглушке
- **mechanism**: манифест не содержит ни `views`, ни `viewsContainers`, `activationEvents` пуст, а `activate()` не регистрирует ничего. Установленное расширение физически не может показать заявленную планом дерево-заглушку — оно вообще ничего не contributes.
- **trigger**: воспроизводится в нормальной работе — установка расширения и попытка увидеть дерево
- **in_scope**: да
- **anchor**: контракт 01-D (activation по view id и видимая дерево-заглушка) против `packages/projects-tree/package.json:32-38` и `packages/projects-tree/src/extension.ts:3-5`
- **evidence**:
  ```json
  "activationEvents": [],
  "contributes": {
    "jsonValidation": [
  ```
  ```ts
  export function activate(_context: vscode.ExtensionContext): void {
    // Intentionally empty: no contributions registered yet.
  }
  ```
- **verification**: confirmed
- **verification_note**: перепроверено чтением полного `package.json` и `extension.ts` — `views`/`viewsContainers`/`commands` в манифесте отсутствуют, `activate` тела не имеет; README пакета прямо говорит об отсутствии views/commands.
- **fix_direction**: явно зафиксировать (в плане или отдельным решением), что видимая дерево-заглушка — контракт следующего этапа, либо реализовать минимальный contribution в рамках этапа 01.

## codex-09

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Полная валидация постоянно исключает docs и workspace-конфиг
- **mechanism**: временное разделение владения файлами между параллельными пакетами работ закреплено в постоянном `.prettierignore` (исключены `docs/**` и `pnpm-workspace.yaml`). Последующие неформатированные изменения планов, архитектурной документации и workspace-конфига не уронят `pnpm check`, хотя формально должны проверяться форматтером наравне с остальным.
- **trigger**: воспроизводится в нормальной работе — правка исключённого файла без форматирования
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
- **verification_note**: перепроверено чтением `.prettierignore` — исключения снабжены комментариями про временное владение пакетом работ, но остаются в файле без пометки TODO/срока снятия.
- **fix_direction**: убрать ownership-обусловленные исключения из `.prettierignore` после завершения параллельной работы над этапом, оставить только содержательные (сгенерированные файлы и т.п.).

## codex-10

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Package LICENSE зависит от поддержки symlink на Windows
- **mechanism**: `packages/projects-tree/LICENSE` — symlink на `../../LICENSE`. При checkout с `core.symlinks=false` (частый случай на Windows) Git материализует symlink как обычный файл с текстовым содержимым `../../LICENSE` вместо текста лицензии. Локальная упаковка на такой машине положит в `.vsix` файл `LICENSE.txt` с путём цели вместо самой лицензии; Linux CI этого не обнаружит, так как там symlink разыменовывается штатно.
- **trigger**: воспроизводится в нормальной работе — стандартный Windows checkout без `core.symlinks=true` и последующая локальная упаковка
- **in_scope**: да
- **anchor**: `packages/projects-tree/LICENSE` (symlink → `../../LICENSE`) в связке с `.gitattributes:4-8` и `docs/architecture.md:40-44`
- **evidence**:
  - `.gitattributes` явно обрабатывает как текстовый symlink-фолбэк только `CLAUDE.md`, не `packages/projects-tree/LICENSE`
  - `docs/architecture.md:40-44` описывает именно эту проблему для `CLAUDE.md`, но не упоминает `packages/projects-tree/LICENSE`
- **verification**: unverifiable
- **verification_note**: механизм подтверждается документально (тот же паттерн уже описан для `CLAUDE.md` в `docs/architecture.md`) и логически (symlink без специальной обработки в `.gitattributes`), но фактическая проверка на Windows-окружении в рамках этого ревью не выполнялась — ни codex, ни я не имеем доступа к Windows-машине.
- **fix_direction**: распространить существующий Windows-фолбэк (аналогичный тому, что описан для `CLAUDE.md`) на `packages/projects-tree/LICENSE`, либо заменить symlink на копию/build-step, либо явно задокументировать ограничение и добавить проверку.

## codex-11

- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: reliability
- **title**: Правила `AGENTS.md` двусмысленны для integration tests
- **mechanism**: `AGENTS.md` формулирует абсолютное правило «не добавлять проверку в CI или package script без включения в `pnpm check`», но следом же требует держать `test:integration` только в CI, вне `pnpm check`. Формально это противоречие; агент должен сам решить, читать ли вторую фразу как исключение из первой.
- **trigger**: воспроизводится в нормальной работе — при реализации integration tests на будущем этапе
- **in_scope**: да
- **anchor**: `AGENTS.md` (раздел Validation)
- **evidence**:
  ```markdown
  Do not add a check to CI or to a package script without also wiring it into `pnpm check`
  ...
  Integration tests (`@vscode/test-cli`, script `test:integration`) are not part of `pnpm check` —
  they require a running editor and run only in CI.
  ```
- **verification**: confirmed
- **verification_note**: перепроверено чтением `AGENTS.md` — обе формулировки действительно расположены рядом и буквально противоречат друг другу без явной пометки «исключение».
- **fix_direction**: явно сформулировать в `AGENTS.md`, что editor-dependent проверки — оговорённое исключение из общего правила, а не нарушение.

## codex-12

- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: reliability
- **title**: Windows-ограничение `CLAUDE.md` отсутствует в README
- **mechanism**: предупреждение про symlink-фолбэк на Windows зафиксировано только в `docs/architecture.md`. Разработчик, начинающий с README (что типично), не узнает, что без `core.symlinks=true` `CLAUDE.md` превратится в текстовый файл с содержимым `AGENTS.md` вместо самого канона.
- **trigger**: воспроизводится в нормальной работе — стандартный Windows `git clone` без предварительно настроенного `core.symlinks=true`
- **in_scope**: да
- **anchor**: DoD пакета 01-C (`docs/plans/projects-tree/01-monorepo-and-tooling.md:97-99`) против `README.md`
- **evidence**:
  ```markdown
  # vscode-extensions

  My extensions for VS Code
  ```
- **verification**: confirmed
- **verification_note**: перепроверено — в `README.md` и `packages/projects-tree/README.md` нет упоминаний `core.symlinks` или Windows.
- **fix_direction**: добавить в корневой README краткое предупреждение о необходимости `core.symlinks=true` на Windows для корректного клонирования `CLAUDE.md`.

## Coverage

Все 8 приоритетов брифа проверены codex исполнением команд (`pnpm check`, `actionlint`, `pnpm exec vsce ls --tree`, `unzip -l`, `pnpm run package` из корня, `pnpm exec prettier --check`, чтение конфигов и контрактов) и точечно перепроверены мной повторным чтением исходников (`.github/workflows/publish.yml`, `.github/workflows/ci.yml`, корневой и extension `package.json`, `extension.ts`, `.dependency-cruiser.mjs`, `.prettierignore`, `AGENTS.md`, `README.md`).

- Приоритет 5 (сборка, `esbuild.mjs`) признан полностью чистым: `platform: node`, `target: node18`, `format: cjs`, `external: ['vscode']` согласованы; расхождение `target: node18` vs `engines.node: >=26` намеренное и не является дефектом (Node 26 — только toolchain, Node 18 — нижняя граница рантайма VS Code); поднятие `engines.vscode` само по себе не требует менять target.
- Приоритет 1 (проверки, которые не проверяют) — находка codex-03 (одна из шести sibling-пар покрыта негативным тестом) и codex-04 (regex `webview-is-isolated` не ловит импорт `extension.ts`); остальные пять проверок (`.dependency-cruiser.mjs` в целом, `knip.json`, `eslint.config.mjs`, `vitest.config.ts`+`smoke.test.ts`) признаны чистыми.
- Приоритет 2 (CI и безопасность workflow) — находка codex-01 (незакреплённый `ovsx` с обоими PAT в общем `env`); `--frozen-lockfile` присутствует во всех трёх workflow (проверено `grep`), `permissions: contents: read` в `ci.yml`/`publish.yml`, `contents: write` только в `release.yml` (обосновано созданием релиза), fork PR не получает secrets (`ci.yml` не читает `secrets.*`).
- Приоритет 3 (швы между пакетами работ) — находка codex-09 (`.prettierignore` навсегда исключает `docs/**` и `pnpm-workspace.yaml`); `allowBuilds` в `pnpm-workspace.yaml` и разделение `tsconfig.base.json`/корневой `tsconfig.json` признаны корректными (codex проверил построением зависимостей).
- Приоритет 4 (манифест) — находки codex-06 (несуществующая JSON Schema) и codex-08 (нет views/activation, DoD о дерево-заглушке невыполним); остальные поля манифеста (`publisher`, `engines.vscode`, точная версия `@types/vscode`, `capabilities.*`, `l10n`) признаны корректными; `.vscodeignore` проверен фактическим составом VSIX (`unzip -l`) — лишнего не попадает, нужное не выпадает.
- Приоритет 6 (симлинки) — находка codex-10 (Windows-риск для `packages/projects-tree/LICENSE`, unverifiable); симлинк `CLAUDE.md` → `AGENTS.md` признан корректно обработанным через `.gitattributes` и задокументирован в `docs/architecture.md`; на macOS `vsce` разыменовал оба симлинка корректно.
- Приоритет 7 (`AGENTS.md`) — находка codex-11 (двусмысленность про integration tests).
- Приоритет 8 (DoD 01-A..01-E) — 01-A выполнен полностью; 01-B, 01-C, 01-D, 01-E расходятся с DoD в частях, зафиксированных находками codex-03/04/07/09 (01-B), codex-12 (01-C), codex-02/05/06/07/08 (01-D), codex-01 (01-E).

Отдельно (не находка, суждение из ответа codex): для репозитория с одним расширением-заглушкой предмет "лишнего" — отдельный webview workspace, полноценная publish job с двумя registries, Knip, commit hooks и полный fixture harness архитектурных правил; это соответствует плану, но уже создаёт заметную maintenance/supply-chain поверхность до появления пользовательской функциональности.

## Отклонённые находки

- codex-R01 | В CI отсутствует `--frozen-lockfile` | refuted: флаг присутствует во всех трёх workflow (перепроверено `grep -n "frozen-lockfile" .github/workflows/*.yml` — совпадения в ci.yml, release.yml, publish.yml).
- codex-R02 | Fork PR получает publish-секреты или write-token | refuted: `ci.yml` имеет только `contents: read`, не обращается к `secrets.*` (перепроверено чтением `ci.yml` и `grep -n "permissions:" -A2`).
- codex-R03 | Отсутствующая секция CHANGELOG создаёт пустой Release | refuted: `release.yml` формирует generic note при отсутствии секции.
- codex-R04 | `target: node18` ошибочно расходится с Node 26 | refuted: Node 26 — toolchain-версия, Node 18 — нижняя граница VS Code runtime; расхождение намеренное.
- codex-R05 | `.vscodeignore` сейчас включает лишнее или исключает нужное | refuted: фактический VSIX (проверено `unzip -l`) содержит только manifest/XML, `package.json`, README, LICENSE, l10n и `dist/extension.js`.
- codex-R06 | Точный `@types/vscode` допускает API новее нижней границы | refuted: версия закреплена точно на `1.85.0` (перепроверено — не диапазон, а точная версия в devDependencies).
- codex-R07 | Smoke test маскирует discovery будущих тестов | refuted: glob `vitest.config.ts` покрывает `src/**` обоих пакетов и `tools/**`.
- codex-R08 | `allowBuilds` в `pnpm-workspace.yaml` содержит посторонние application-зависимости | refuted: записи относятся к текущему build/tooling graph.
