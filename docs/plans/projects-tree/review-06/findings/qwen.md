# Находки — qwen (round 06, этап 03 ProjectsTree)

Ревью проведено внешним CLI `qwen` (обёртка `qwen-eval.sh`, код возврата 0, полный ответ сохранён
в `docs/plans/projects-tree/review-06/raw/qwen.md`). Каждая находка ниже верифицирована фасилитатором
по коду (Read/grep), независимо от собственного `verification` внутри ответа Qwen.

### qwen-01

- **reviewer**: qwen
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Курица-и-яйцо активации: оба view гейтированы context keys, которые выставляются только после активации, а активируют расширение только `onView:` на эти же view
- **mechanism**: `activationEvents` манифеста содержит только `onView:projectsTree.view` и `onView:projectsTree.explorerView`. Оба view объявлены с `when`, ссылающимся на `projectsTree.locationIs*` — context keys, которые `setContext` выставляет только внутри `refreshFromSettings()`, вызываемой из `activate()`. Если `onView:` в VS Code срабатывает только когда view реально «готовится к показу» (что подразумевает пройденный `when`), а `when` до активации ложен — ни один из двух `onView:` не сработает в свежем окне, и расширение не активируется никаким платформенным механизмом, кроме ручного вызова команды из палитры (автогенерируемый `onCommand:`).
- **trigger**: воспроизводится в нормальной работе (любое свежее окно редактора), если поведение платформы для `onView:` на view со скрытым `when` таково, как описано; ручной обход — палитра команд
- **in_scope**: да
- **anchor**: контракт «03-C: активация + размещение» (`docs/plans/projects-tree/03-tree-view.md`, DoD «все три режима работают») + `packages/projects-tree/package.json:32-35,64-75`
- **evidence**:
  ```json
  "activationEvents": [
    "onView:projectsTree.view",
    "onView:projectsTree.explorerView"
  ],
  ```
  ```json
  { "id": "projectsTree.view", "when": "projectsTree.locationIsActivityBar" }
  ```
- **verification**: unverifiable
- **verification_note**: подтверждено чтением `package.json` (activationEvents/views/when совпадают
  с описанием) и `extension.ts` (context keys выставляются только внутри `refreshFromSettings()`,
  вызываемой из `activate()`, до этого нигде не выставляются). Сам механизм `onView:` для view со
  скрытым `when` не задокументирован в `api-facts.md` — ни цитаты, подтверждающей, ни цитаты,
  опровергающей дедлок, нет. Требует прогона на свежем `--user-data-dir` без ручного `activate()`,
  которого фасилитатор сделать не может (read-only ревью, среда без живого редактора).
- **fix_direction**: проверить активацию на свежем профиле редактора; при подтверждении дедлока
  добавить безусловное событие активации (например `onStartupFinished`) и зафиксировать
  дословную цитату об этом поведении `onView:` в `api-facts.md`; интеграционный тест на активацию
  не должен подменять платформенный запуск ручным `extension.activate()`.

### qwen-02

- **reviewer**: qwen
- **severity**: HIGH
- **kind**: point
- **domain**: tests
- **title**: `test:integration` и джоба `integration-test` не собирают `dist/`, на который указывает `main` манифеста — `activation.test.ts` на чистом checkout падает или проверяет устаревший бандл
- **mechanism**: манифест объявляет `"main": "./dist/extension.js"`. Скрипт `test:integration`
  выполняет только `rm out` → `tsc -p test/tsconfig.json` → `vscode-test`, без шага esbuild-сборки.
  `dist/` исключён `.gitignore`. Джоба `integration-test` в CI делает `checkout` → `pnpm install` →
  сразу `test:integration`, тоже без сборки. `activation.test.ts` активирует расширение через
  `vscode.extensions.getExtension(...).activate()`, что требует загрузки реального `main`-файла
  тестовым хостом редактора. На чистом checkout (в первую очередь CI) `dist/extension.js`
  физически отсутствует.
- **trigger**: воспроизводится в нормальной работе — любой чистый checkout, в первую очередь джоба `integration-test`
- **in_scope**: да
- **anchor**: `packages/projects-tree/package.json:20,202`; `.github/workflows/ci.yml:53-97`
- **evidence**:
  ```json
  "main": "./dist/extension.js",
  ```
  ```json
  "test:integration": "node -e \"fs.rmSync('out',{recursive:true,force:true})\" && tsc -p test/tsconfig.json && vscode-test"
  ```
- **verification**: confirmed
- **verification_note**: перепроверено самостоятельно — `main` действительно `./dist/extension.js`,
  `.gitignore` содержит `dist/`, скрипт `test:integration` не содержит шага сборки, джоба
  `integration-test` в `.github/workflows/ci.yml:53-97` идёт `checkout → pnpm install → xvfb-run
  test:integration` без промежуточного build. В рабочем дереве `dist/extension.js` присутствует
  (уцелевший локальный артефакт от прежней сборки) — это объясняет, почему заявленный командой
  зелёный локальный прогон возможен, не опровергая проблему на чистом checkout/CI.
- **fix_direction**: добавить сборку бандла (`esbuild`/`pnpm --filter projects-tree run build` или
  аналог) в `test:integration` либо отдельным шагом джобы перед запуском `vscode-test`.

### qwen-03

- **reviewer**: qwen
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: `ExpansionStore.retainOnly` покрыт юнит-тестами, но не вызывается из production-кода
- **mechanism**: метод экспортирован и протестирован (`expansion.test.ts:74,85`), но нигде в
  `src/**`/`extension.ts` не вызывается за пределами собственного теста. Ключи раскрытия пишутся в
  `globalState` при каждом expand/collapse и никогда не чистятся — множество растёт на весь срок
  жизни установки; удалённый или переименованный на диске узел оставляет ключ навсегда. Это тот же
  класс дефекта, что M1 из round 05 («стратегия реализована, покрыта тестами, никогда не вызывается
  из production»).
- **trigger**: воспроизводится в нормальной работе — каждая сессия, где что-то раскрывается/сворачивается, оставляет ключи, которые никогда не удаляются
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/tree-view/expansion.ts:68-84`
- **evidence**:
  ```ts
  retainOnly(livingKeys: Iterable<NodeKey>): PromiseLike<void> | undefined {
    const living = new Set(livingKeys);
  ```
- **verification**: confirmed
- **verification_note**: `grep -rn "retainOnly" packages/projects-tree/src packages/projects-tree/test`
  даёт только определение (`expansion.ts:75`) и два вызова из `expansion.test.ts:74,85` — вызова
  из `extension.ts` или другого production-кода нет.
- **fix_direction**: вызывать чистку из `refreshFromSettings()`/`refresh()` с ключами текущего
  дерева, либо явно задокументировать отсрочку до последующего этапа плана и удалить метод из
  публичной поверхности до тех пор.

### qwen-04

- **reviewer**: qwen
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Висячие `%key%`-ссылки манифеста не проверяет ни одна из существующих проверок
- **mechanism**: `tools/check-l10n.ts` сверяет только паритет множества ключей между
  `package.nls.json` и `package.nls.ru.json` — не проверяет, что каждая `%ссылка%` в `package.json`
  разрешается в существующий ключ. `manifest-contract.test.ts` умеет проверять разрешение `%key%`,
  но только для `contributes.colors[].description`. Удаление ключа из обоих nls-файлов (или
  опечатка в ссылке манифеста) не ловится ни одной из этих проверок — обе остаются зелёными, а
  пользователь увидит литерал `%command.refresh.title%`.
- **trigger**: воспроизводится в нормальной работе — правка манифеста/nls-файлов при добавлении команд/меню в последующих этапах
- **in_scope**: да
- **anchor**: `tools/check-l10n.ts:264-284`; `packages/projects-tree/src/editor/tree-view/manifest-contract.test.ts`
- **evidence**:
  ```ts
  const manifestEn = readJsonRecord(PACKAGE_NLS_EN);
  const manifestRu = readJsonRecord(PACKAGE_NLS_RU);
  const manifestDiff = diffKeySets(Object.keys(manifestEn), Object.keys(manifestRu));
  ```
- **verification**: confirmed
- **verification_note**: прочитаны `runCheck` в `tools/check-l10n.ts` целиком (только паритет
  ключей двух nls-файлов) и `manifest-contract.test.ts` (проверка `%key%` ограничена
  `colors[].description`) — ни один `%…%` из `views`/`commands`/`configuration`/`viewsWelcome` не
  проверяется на разрешимость.
- **fix_direction**: расширить контрактный тест манифеста (или `check-l10n`) на проверку всех
  `%ключ%`-ссылок `package.json` против `package.nls.json`, а не только описаний цветов.

### qwen-05

- **reviewer**: qwen
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: Guard запуска `main()` в `check-l10n.ts` — строковое сравнение URL с сырым путём процесса, ломается на Windows и путях со спецсимволами
- **mechanism**: `main()` вызывается только при `import.meta.url === \`file://${process.argv[1]}\``.
  `import.meta.url` — percent-кодированный file-URL, `process.argv[1]` — сырой путь ОС. На Windows
  сравнение не сходится (обратные слэши против `file:///C:/…`), на POSIX ломается на путях,
  требующих percent-кодирования (пробел → `%20`, `#`, не-ASCII). При несовпадении скрипт тихо
  завершается кодом 0 — `l10n:check` и `l10n:generate` становятся no-op без единой диагностики.
- **trigger**: только на рукотворном входе — checkout в каталоге с пробелами/спецсимволами в пути, либо рабочая машина под Windows
- **in_scope**: да
- **anchor**: `tools/check-l10n.ts:369-372`
- **evidence**:
  ```ts
  if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
    main();
  }
  ```
- **verification**: confirmed
- **verification_note**: код прочитан дословно, совпадает с evidence; `check-l10n.test.ts`
  испытывает только `extractRuntimeKeys`, `main()` не покрыт ни одним тестом. На путях без
  пробелов/спецсимволов на Linux/macOS сравнение сходится, что не противоречит заявленному
  зелёному `pnpm check`.
- **fix_direction**: сравнивать канонизованные пути (`fileURLToPath(import.meta.url)` против
  `path.resolve(process.argv[1])`) вместо сравнения сырых строк.

### qwen-06

- **reviewer**: qwen
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Решение 03-A «реестр сбрасывается при смене правил или корней» не подключено — `invalidate`/`forget` `NodeRegistry` вызываются только тестами
- **mechanism**: план 03-A требует сброса `NodeRegistry` при смене корней/правил. В `extension.ts`
  `refreshFromSettings` пересобирает граф при смене корней, но не вызывает ни
  `nodeRegistry.invalidate()`, ни `nodeRegistry.forget()` — карта канонических узлов живёт до конца
  сессии. Последствия ограничены памятью (дерево рендерится из свежего результата обхода), поэтому
  не выше MEDIUM.
- **trigger**: воспроизводится в нормальной работе — каждая смена `projectsTree.roots` оставляет узлы прежних корней в реестре до конца сессии
- **in_scope**: нет — `registry.ts`/`registry.test.ts` не входят в список файлов диапазона `ad7bb67..HEAD`; якорь существует до начала диффа и этим раундом не тронут
- **anchor**: контракт 03-A (`docs/plans/projects-tree/03-tree-view.md`, «реестр сбрасывается при смене правил или корней»); `packages/projects-tree/src/projects/discovery/registry.ts`
- **evidence**:
  ```ts
  // registry.test.ts — единственные вызовы во всём репозитории:
  registry.forget(nodeKey('r1', 'a'));
  registry.invalidate();
  ```
- **verification**: confirmed
- **verification_note**: `grep -rn "\.invalidate(\|\.forget("` по `src/**` и `test/**` даёт только
  `registry.test.ts:76,86`; `extension.ts` не вызывает ни один из методов.
- **fix_direction**: либо сбрасывать реестр при изменении корней в `refreshFromSettings`, либо
  явно записать отсрочку в раздел «Решения, изменённые при реализации» плана — сейчас отклонение от
  зафиксированного решения не задокументировано. Находка вне диффа этого раунда, отчёт — для полноты
  картины, не для приёмки round 06.

### qwen-07

- **reviewer**: qwen
- **severity**: LOW
- **kind**: pattern
- **domain**: style
- **title**: Комментарии двух новых файлов описывают конфигурацию, которой не существует
- **mechanism**: комментарий кэш-шага джобы CI обосновывает стратегию кэша «закреплённой `version` в
  `.vscode-test.mjs»`, но в этом файле поле `version` не задано — `@vscode/test-cli` берёт `stable`,
  то есть кэш растёт не «пока версия не сдвинется в конфиге», а пока не обновится `stable`.
  Комментарий `.vscode-test.mjs` ссылается на несуществующий `tsconfig.test.json` с `rootDir "."`,
  тогда как реальный файл — `test/tsconfig.json` с `rootDir ".."`.
- **trigger**: недостижим — это комментарии, не исполняемый код
- **in_scope**: да
- **anchor**: `.github/workflows/ci.yml:77-83`; `packages/projects-tree/.vscode-test.mjs:22`
- **evidence**:
  ```yaml
  # ...does not change between runs unless the pinned `version` in `.vscode-test.mjs` moves — ...
  ```
  ```js
  // tsconfig.test.json emits here (rootDir "." -> outDir "out", mirroring test/ and src/).
  ```
- **verification**: confirmed
- **verification_note**: `.vscode-test.mjs` прочитан целиком — поля `version` нет; реальный путь и
  `rootDir` в `test/tsconfig.json` не совпадают с текстом комментария.
- **fix_direction**: либо действительно закрепить версию редактора в `.vscode-test.mjs` (заодно
  закрыв невоспроизводимость интеграционных тестов на движущемся `stable`), либо привести текст
  комментариев в соответствие с фактическим поведением и именами файлов.

### qwen-08

- **reviewer**: qwen
- **severity**: LOW
- **kind**: contract
- **domain**: tests
- **title**: Тест `item.test.ts` читает `ThemeColor.id` обратно вопреки зафиксированному после факта 43 решению
- **mechanism**: раздел «Решения, изменённые при реализации» (`03-tree-view.md`) прямо фиксирует:
  «`ThemeColor` конструируется на самом краю и никогда не читается обратно — ни в production, ни в
  тесте». Тест `item.test.ts` нарушает это буквально: фейковый `ThemeColor` объявлен с полем `id`, и
  тест утверждает `icon.color?.id`. На типовой планке (`@types/vscode`) `ThemeColor.id` недоступен —
  вреда на реальном типе нет, но паттерн нормализует ровно то чтение, из-за которого факт 43 уже
  однажды пришлось исправлять.
- **trigger**: недостижим — тестовый фейк, не production-код
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/03-tree-view.md:180-181` (решение) против `packages/projects-tree/src/editor/tree-view/item.test.ts:156-158`
- **evidence**:
  ```ts
  const icon = item.iconPath as { id: string; color?: { id: string } };
  expect(icon.id).toBe('star');
  expect(icon.color?.id).toBe('projectsTree.highlight');
  ```
- **verification**: confirmed
- **verification_note**: текст решения в `03-tree-view.md:180-181` сверен дословно («никогда не
  читается обратно — ни в production, ни в тесте»); `item.test.ts:156-158` читает `icon.color?.id`
  через тестовый фейк-тип. `decoration-provider.test.ts` тот же фейк `id` не читает.
- **fix_direction**: утверждать цвет без чтения `.id` (сравнивать сконструированный фейк-экземпляр
  целиком либо перехватывать аргумент конструктора), либо уточнить формулировку решения так, чтобы
  запрет касался только реального типа `vscode.ThemeColor`.

### qwen-09

- **reviewer**: qwen
- **severity**: LOW
- **kind**: point
- **domain**: style
- **title**: Факт 39 `api-facts.md`: номера строк полей `TreeViewOptions` меньше номера строки самого интерфейса — ссылка невоспроизводима
- **mechanism**: строка фактов цитирует `export interface TreeViewOptions<T>` на `vscode.d.ts:11852`,
  а поля `treeDataProvider`/`showCollapseAll`/`canSelectMany`/`dragAndDropController` — на строках
  `:1855-1857`/`:1862`/`:1868`/`:1873`, то есть на десять тысяч строк раньше объявления самого
  интерфейса. Похоже на потерянный префикс `11`. Правило 4 самой таблицы (`api-facts.md`) требует
  воспроизводимой цитаты — по этому же правилу такая строка недействительна.
- **trigger**: недостижим — это документация, не исполняемый код; существование полей машинно
  подтверждается `typecheck` на планке 1.85 независимо от точности номеров строк
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:531-533`
- **evidence**:
  ```
  `vscode.d.ts:11852` (`export interface TreeViewOptions<T> {`) с полями `treeDataProvider`
  (`:1855-1857`), `showCollapseAll?: boolean` (`:1862`), `canSelectMany?: boolean` (`:1868`),
  ```
- **verification**: confirmed
- **verification_note**: внутренняя арифметика самой строки — номера строк полей меньше номера
  строки объявления интерфейса, значит физически не могут лежать внутри него; несостыковка видна
  без обращения к самому `vscode.d.ts`.
- **fix_direction**: переснять номера строк полей по фактическому файлу `@types/vscode@1.85.0`
  (вероятно `11855-11857` и далее), как того требует правило 4 `api-facts.md`.

## Coverage — проверено и признано чистым

- **Проводка новых экспортируемых символов из production** (главная гипотеза раунда): `readLocation`/
  `setLocationContextKeys`/`ALL_VIEW_IDS`/`ExpansionStore`/`treeElementKey`/`HighlightDecorationProvider`
  в `extension.ts`, `locationContextKeys` в `context-keys.ts`, `toTreeItemLabel` в `item.ts`,
  `buildDecorationSpec`/`isBadgeWithinPlatformLimit` в `decoration-provider.ts` — у всех есть
  вызовы вне тестов. Единственное подтверждённое исключение внутри диффа — `ExpansionStore.retainOnly`
  (qwen-03); `NodeRegistry.invalidate/forget` (qwen-06) — тот же класс дефекта, но якорь вне диффа
  этого раунда.
- **Шов 03-B ↔ интеграционные тесты**: конструктор `ProjectsTreeProvider` с обязательным 7-м
  аргументом `isExpanded` — все четыре интеграционные сюиты (`discovery`, `location`,
  `refresh-identity`, `resilience`) передают его; поймал бы компилятор, если бы нет.
- **`ExpansionStore` ↔ `TreeItem.id`**: ключ раскрытия пишется и читается одной функцией
  `treeElementKey`, `item.id` в `item.ts` присваивается тем же значением; корневые группы — общий
  неймспейс `root:<rootId>` с обеих сторон.
- **Декорации**: единица подсчёта бейджа — code points и в ядре
  (`src/projects/classification/validation.ts`), и в адаптере (`decoration-provider.ts`) —
  совпадает; сверхлимитный бейдж отбрасывается с сохранением цвета; пустой `DecorationSpec` не
  становится `FileDecoration`; `propagate = true` на каждой декорации, сигнал уходит и по самому
  URI, и по предкам.
- **Поправка факта 43**: в production-коде `ThemeColor` только конструируется в одном месте
  (`decoration-provider.ts`), `colorId` живёт строкой и нигде не читается обратно; единственное
  исключение — тестовый фейк, вынесено отдельной находкой (qwen-08).
- **Два view**: разные id (`projectsTree.view`/`projectsTree.explorerView`); `activationEvents`,
  `viewsWelcome`, `view/title`-меню продублированы на оба id; режим `none` гасит оба context key
  (`locationContextKeys('none')` — оба `false`).
- **Локализация**: `check-l10n` ре-экстрагирует ключи из AST при каждом запуске, а не сверяется со
  своим же генератом; нелитеральные первые аргументы `l10n.t` (шаблонная строка, переменная,
  отсутствие аргументов) дают ошибку экстрактора, а не тихий пропуск. Дыра — только по `%key%`-ссылкам
  манифеста (qwen-04) и по guard'у запуска CLI (qwen-05).
- **Механизмы M1-M6 из round 05 в этом диффе не воспроизведены повторно**, за вычетом одного нового
  случая того же класса (qwen-03/qwen-06 — «реализовано и протестировано, но не вызывается из
  production», прямой аналог исходного M1).
- **CI и тулинг**: `xvfb-run -a` — только Linux-джоба; `**/.vscode-test/**` в `eslint.config.mjs`;
  `ignoreDependencies: ["@vscode/test-electron"]` в `knip.json` — соответствуют описанному в BRIEF.

## Отклонённые находки (refuted)

| id | title | причина |
|---|---|---|
| qwen-r01 | Единицы подсчёта бейджа расходятся между ядром и адаптером | опровергнуто: оба считают `[...s].length` — code points, совпадает |
| qwen-r02 | Ключ записи раскрытия не совпадает с `TreeItem.id`, фича молча не работает | опровергнуто: обе стороны используют `treeElementKey`, включая `root:<rootId>` |
| qwen-r03 | `check-l10n` сравнивает против собственного генерата и всегда зелёный | опровергнуто: `check` ре-экстрагирует ключи из исходников заново при каждом запуске |
| qwen-r04 | `propagate` сигналит только сам узел, предки не переспрашиваются | опровергнуто: сигнал уходит по URI узла и по всей цепочке предков |
| qwen-r05 | Режим `none` оставляет один из двух view видимым | опровергнуто: `locationContextKeys('none')` даёт оба `false` |
| qwen-r06 | Экстрактор `l10n.t` молча пропускает нелитеральные аргументы | опровергнуто: такие формы попадают в `errors` и роняют exit-код, покрыто тестами |
| qwen-r07 | Production-код всё ещё читает `ThemeColor.id` после правки факта 43 | опровергнуто: читает только тестовый фейк (см. qwen-08, LOW) |
| qwen-r08 | `viewsWelcome`/меню/`activationEvents` не продублированы на второй view | опровергнуто: манифест несёт дубли на оба id |
| qwen-r09 | Раскрытие не переносится между двумя view | опровергнуто: для узла, впервые появившегося в данном view, побеждает дефолт `getTreeItem`, который `isExpanded` поднимает до `Expanded` — заявленный механизм соблюдён |
| qwen-r10 | Прямая зависимость `mocha@^12` не используется, т.к. `@vscode/test-cli` тянет свою | не проверено фасилитатором (требует запуска `knip`, который в это ревью не входит по заданию); qwen сам пометил как неразрешённое, не как `refuted` — оставлено в этой секции по формальному признаку «не находка», но статус фактически `unverifiable`, не `refuted` |
