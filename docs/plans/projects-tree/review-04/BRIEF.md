# Review brief — реализация этапа 01 (round 04)

## Что ревьюируем

**Код и конфигурацию**, а не план. Этап 01 «Монорепо, тулинг, канон агента, манифест, CI и релизы»
реализован полностью, `pnpm check` зелёный (exit 0), `.vsix` собран и проверен установкой в
VS Code 1.136.0.

Материал — рабочее дерево ветки `feat/projects-tree-scaffold`. Файлы **не закоммичены** (untracked),
поэтому `git diff` пуст: смотрите `git status --short` и читайте файлы напрямую.

Состав материала:
- корень: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `tsconfig.base.json`,
  `tsconfig.json`, `.gitignore`, `.gitattributes`, `.editorconfig`, `.prettierrc`, `.prettierignore`,
  `eslint.config.mjs`, `.dependency-cruiser.mjs`, `knip.json`, `vitest.config.ts`,
  `commitlint.config.mjs`, `lefthook.yml`, `AGENTS.md`, `CLAUDE.md` (симлинк), `CHANGELOG.md`,
  `LICENSE`
- `tools/`: `depcruise-negative.mjs`, `smoke.test.ts`, `architecture-fixtures/**`
- `packages/projects-tree/`: `package.json` (манифест расширения), `esbuild.mjs`, `.vscodeignore`,
  `README.md`, `LICENSE` (симлинк), `l10n/bundle.l10n.json`, `tsconfig.json`, `src/extension.ts`
- `packages/projects-tree/webview/`: `package.json`, `tsconfig.json`, `src/main.ts`
- `.github/`: `workflows/{ci.yml,release.yml,publish.yml}`, `dependabot.yml`
- `docs/architecture.md`

Контракт, которому это должно соответствовать: `docs/plans/projects-tree/01-monorepo-and-tooling.md`
(все пять пакетов и их DoD). Сквозные решения — `docs/plans/projects-tree/00-overview.md`.
Утверждения об API — `docs/plans/projects-tree/api-facts.md`.

## Приоритеты

1. **Проверки, которые не проверяют.** Главный риск тулинга — зелёный результат при реальном
   нарушении. Проверьте каждую из семи проверок `pnpm check` на этот отказ:
   - `.dependency-cruiser.mjs`: ловят ли шесть правил то, что заявлено? Обратите внимание на
     `no-sibling-internals` (реализовано как 6 попарных правил, потому что backreference между
     `from.path` и `to.path` в dependency-cruiser нет) и на `no-node-builtins-in-core-logic`
     (матчится по `dependencyTypes: ['core']`, т.к. `node:fs` резолвится в `fs` без префикса).
     Есть ли способ нарушить границу так, что ни одно правило не сработает?
   - `tools/depcruise-negative.mjs`: инверсия проверена оркестратором двумя векторами (severity
     `ignore` и подмена условия) — краснеет корректно. Есть ли третий вектор, который она пропустит?
   - `knip.json`: не настроен ли он так, что игнорирует всё существенное?
   - `eslint.config.mjs`: типизированный линтинг реально покрывает `tools/**` и оба пакета?
   - `vitest.config.ts` + `tools/smoke.test.ts`: тест-заглушка не маскирует отсутствие настройки?
2. **CI и безопасность workflow.** `ci.yml` срабатывает на `pull_request` — оцените риск для
   форков (исполнение кода PR, доступ к артефактам, `GITHUB_TOKEN` permissions). Есть ли
   `--frozen-lockfile` при установке; если нет — это дефект. `publish.yml`: секреты проброшены в
   `env` джобы, `if` проверяет `env.*` (исправление ревью — `secrets` недоступен в `if` вообще);
   не появилось ли при этом новой дыры. `release.yml`: разбор CHANGELOG через `awk`, оцените
   поведение на отсутствующей секции. Проверьте `permissions:` во всех трёх.
3. **Швы между пакетами работ.** Файлы делались параллельно четырьмя агентами с непересекающимися
   наборами. Назовите поимённо общие точки и скажите, какую форму входа не покрыл ни один пакет:
   - корневой `package.json` (владелец 01-B) против `packages/projects-tree/package.json` (01-D);
   - `tsconfig.base.json` (01-A) против корневого `tsconfig.json` (создан 01-B по необходимости);
   - `.prettierignore` исключает `docs/**` и `pnpm-workspace.yaml` — обосновано владением, но не
     маскирует ли это реальные проблемы;
   - `pnpm-workspace.yaml` получил `allowBuilds` от `pnpm approve-builds` во время работы 01-D, то
     есть чужой пакет изменил файл 01-A. Проверьте, что содержимое корректно.
4. **Манифест расширения.** `publisher: fractalizer`, `engines.vscode: ^1.85.0`,
   `@types/vscode: 1.85.0` (точная версия — намеренно, чтобы typecheck не разрешал API новее
   планки), `capabilities.untrustedWorkspaces: limited`, `capabilities.virtualWorkspaces: false`,
   `l10n: ./l10n`, `activationEvents: []`, `contributes.jsonValidation` со ссылкой на ещё не
   существующий файл схемы (проверено: `vsce package` это не ломает). Что здесь неверно или
   упущено? Отдельно: `.vscodeignore` — не попадает ли в `.vsix` лишнее и не выпадает ли нужное.
5. **Сборка.** `esbuild.mjs`: `target: node18` (рантайм редактора) при `engines.node: ">=26"`
   (тулинг) — намеренное расхождение. Формат `cjs`, `external: ['vscode']`. Корректно ли, и что
   будет при поднятии `engines.vscode`.
6. **Симлинки.** `CLAUDE.md` → `AGENTS.md` и `packages/projects-tree/LICENSE` → `../../LICENSE`.
   Git хранит первый как mode 120000 (проверено). Оцените поведение на Windows, в `vsce package`
   (LICENSE.txt в `.vsix` — 1.05 KB, то есть разыменован) и при клонировании в CI.
7. **`AGENTS.md` как рабочий документ.** Он предписывает правила будущим агентам. Найдите
   правило, которое невыполнимо, двусмысленно или противоречит реализации.
8. **Соответствие плану.** Пройдите по DoD всех пяти пакетов 01-A..01-E и скажите, что заявлено
   выполненным, но фактически не сделано или сделано иначе.

Отдельно ценно: что в этой инфраструктуре **лишнее** для репозитория с одним расширением-заглушкой.

## Формат отчёта

Схема: `/Users/fractalizer/PhpstormProjects/git.dvizh.io/ai-tools/dvizh-marketplace/vr/review/reference/finding-schema.md`

- материал — код и конфигурация, поэтому `kind: point`/`pattern` должны преобладать; `evidence` —
  цитата из файла материала;
- `in_scope`: «да» для всего материала (весь этап новый);
- секция coverage обязательна: какие из 8 приоритетов проверены и признаны чистыми;
- секция `refuted` обязательна, если что-то отклонили;
- **проверяйте исполнением, где можете**: `pnpm check`, `pnpm depcruise:negative`, `actionlint`,
  `vsce ls`, попытки нарушить правила границ. Находка, подтверждённая прогоном, ценнее рассуждения.

Файл отчёта: `docs/plans/projects-tree/review-04/findings/<reviewer id>.md` относительно
/Users/fractalizer/PhpstormProjects/github.com/FractalizeR/vscode-extensions

Пишите только свой файл. Не правьте материал — ни конфиги, ни план. `fix_direction` без реализации.
Если вы что-то сломали при проверке (например, правило в конфиге) — верните как было и скажите об этом.
