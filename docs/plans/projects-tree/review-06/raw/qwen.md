# Ревью раунда 06 — этап 03 (диапазон `ad7bb67..HEAD`)

**В первую очередь, как просил оркестратор:**

1. **Решение, опирающееся на утверждение об API, которого нет в `api-facts.md`** — qwen-01: размещение 03-C предполагает, что расширение активируется в свежем окне, хотя оба `activationEvents` — это `onView:` на view, чей `when` выставляется только внутри `activate()`. Строки о том, когда (и активируется ли вообще) расширение для view со скрытым `when`, в таблице нет.
2. **Строка `api-facts.md`, расходящаяся с источником** — qwen-09: факт 39 ссылается на поля `TreeViewOptions` по строкам `:1855-1857`/`:1862`/`:1868`/`:1873` при самом интерфейсе на `:11852` — ссылки невоспроизводимы (очевидная потеря префикса `11`).
3. **Проверка, зелёная при удалённом защищаемом поведении** — qwen-04 (висячая `%key%`-ссылка манифеста не ловится ничем), qwen-05 (весь l10n-гейт молча превращается в no-op на путях с пробелами/в Windows), qwen-03 (поведение «чистка устаревших ключей» покрыто тестом, но в production отсутствует — проверка зелёная, поведения нет).

---

### qwen-01

- **reviewer**: qwen
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Курица-и-яйцо активации: оба view гейтированы context keys, которые выставляются только после активации, а активируют расширение только `onView:` на эти же view
- **mechanism**: 03-C сделал видимость обоих view зависимой от `projectsTree.locationIs*`, выставляемых через `setContext` внутри `refreshFromSettings()` → только после `activate()`. `activationEvents` манифеста содержит исключительно два `onView:`. View с ложным `when` не рендерится, а `onView:` срабатывает только по факту рендера — это прямо признаёт сам интеграционный тест (цитата в evidence). Контейнер в activity bar при нуле активных view скрывается платформой (`hideIfEmpty: true`, факт 47 — цепочка цитат из `viewsService`/`viewContainerModel` в той же таблице). Итог: в свежем окне ни один механизм не запускает расширение — ни иконки контейнера, ни view, ни welcome — пока пользователь вручную не выполнит команду из палитры (автогенерируемый `onCommand:` для внесённых команд). Дополнительная часть нарушения: поведение «расширение как-то активируется, когда все его view скрыты `when`» не имеет строки в `api-facts.md` (правило 1 канона) — решение держится на неподтверждённом допущении. Интеграционные тесты дыру не видят: и `activation.test.ts`, и `location.test.ts` вызывают `extension.activate()` вручную.
- **trigger**: воспроизводится в нормальной работе (любое свежее окно редактора после установки), если поведение платформы таково, как документирует факт 47 и комментарий собственного теста; ручной обход — палитра команд
- **in_scope**: да
- **anchor**: контракт «03-C: активация + размещение» (`03-tree-view.md`, DoD «все три режима работают», «context keys выставлены при активации») + правило 1 `api-facts.md`
- **evidence**:
  ```json
  "activationEvents": [
    "onView:projectsTree.view",
    "onView:projectsTree.explorerView"
  ],
  ```
  ```ts
  // test/integration/location.test.ts:29-30
  // `onView:*` activation events (package.json) only fire once a contributed view is actually
  // rendered, which this suite never does — activate explicitly …
  ```
- **verification**: unverifiable
- **verification_note**: запустить редактор в рамках этого ревью нельзя; механизм логически следует из факта 47 (цепочка цитат в `api-facts.md`) и собственного комментария интеграционного теста, но финальный вердикт требует прогона на свежем профиле (чистый `--user-data-dir`, без ручного `activate()`). Если платформа всё же активирует расширение для скрытых view — находка снимается, но строка в `api-facts.md` про это всё равно обязана появиться.
- **fix_direction**: проверить активацию на свежем профиле; при подтверждении дедлока добавить безусловное событие активации (например `onStartupFinished`), записав его поведение дословной цитатой в `api-facts.md`; интеграционный тест на активацию не должен подменять платформенный запуск ручным `activate()`.

---

### qwen-02

- **reviewer**: qwen
- **severity**: HIGH
- **kind**: point
- **domain**: tests
- **title**: `test:integration` и джоба `integration-test` не собирают `dist/`, на который указывает `main` манифеста, — сюита `activation.test.ts` на чистом checkout падает либо проверяет устаревший бандл
- **mechanism**: манифест расширения объявляет `"main": "./dist/extension.js"` (артефакт esbuild). Скрипт `test:integration` делает только `rm out` + `tsc -p test/tsconfig.json` + `vscode-test` — он собирает `out/` для пяти сюит, идущих в провайдера напрямую, но не запускает `build`. `dist/` в git не лежит (`.gitignore`). `activation.test.ts` активирует расширение через хост редактора, который грузит расширение по `main`: на свежем клоне (то есть в джобе `integration-test`, где шагов сборки нет вовсе) файл отсутствует — сюита падает. Локально зелёный прогон возможен только при `dist/`, оставшемся от предыдущей сборки, — тогда единственный тест, проверяющий реальную активацию, гоняет код не того коммита. Комментарий джобы «integration tests exercise the source tree directly» верен для пяти сюит и неверен для шестой — на этой посылке обоснован и параллельный запуск джобы без зависимости от `check`.
- **trigger**: воспроизводится в нормальной работе (любой чистый checkout, в первую очередь CI)
- **in_scope**: да
- **anchor**: `packages/projects-tree/package.json:202` (плюс `.github/workflows/ci.yml:60-97` — в джобе шага сборки тоже нет)
- **evidence**:
  ```json
  "main": "./dist/extension.js",
  …
  "test:integration": "node -e \"fs.rmSync('out',{recursive:true,force:true})\" && tsc -p test/tsconfig.json && vscode-test"
  ```
  `dist/` отсутствует в рабочем дереве (глоб пуст) и исключён `.gitignore` (`dist/`).
- **verification**: confirmed
- **verification_note**: сверено: манифест (`main`), скрипт (нет шага esbuild), `.gitignore` (`dist/`), `esbuild.mjs` (`outfile: 'dist/extension.js'`), файлы джобы в `ci.yml` (нет build-шага); заявленный командой зелёный `test:integration` объясним только локально уцелевшим `dist/`.
- **fix_direction**: добавить сборку бандла в `test:integration` (или отдельным шагом джобы) до запуска `vscode-test`; не полагаться на артефакт, переживающий локальные прогоны.

---

### qwen-03

- **reviewer**: qwen
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: `ExpansionStore.retainOnly` покрыт юнит-тестами, но не вызывается из production — чистка устаревших ключей раскрытия не происходит никогда
- **mechanism**: ровно тот класс дефекта шва, который назван в отчёте round 05 (M1, «вызов из production-кода существует» стал обязательным пунктом приёмки): метод экспортирован, документирован и протестирован (два теста), но единственный потребитель — его собственный тест. Ключи раскрытия пишутся в `globalState` при каждом expand/collapse и не чистятся ни в `refresh()`, ни в `extension.ts` — множество растёт всю жизнь установки, а удалённый/переименованный на диске проект оставляет ключ навсегда; док-комментарий метода сам называет это последствие. Функциональной поломки нет (повторное появление пути раскроет узел — скорее желательно), поэтому не выше MEDIUM.
- **trigger**: воспроизводится в нормальной работе (каждая сессия что-то раскрывает; устаревшие ключи не удаляются ни при каком сценарии)
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/tree-view/expansion.ts:68-84` + приёмочный критерий из `review-05/REPORT.md` (M1)
- **evidence**:
  ```ts
  retainOnly(livingKeys: Iterable<NodeKey>): PromiseLike<void> | undefined {
    const living = new Set(livingKeys);
  ```
  grep по репозиторию: вызовы `retainOnly` — только `expansion.test.ts:74,85` и определение.
- **verification**: confirmed
- **verification_note**: grep по `src/**` и `extension.ts`: производственного вызова нет; `update()` провайдера и обработчики событий в `extension.ts` — единственные точки интеграции, и они `retainOnly` не трогают.
- **fix_direction**: либо вызывать чистку из `refresh()` с ключами текущего дерева, либо удалить метод вместе с его тестами и явно записать отсрочку до этапа 07.

---

### qwen-04

- **reviewer**: qwen
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Висячие `%key%`-ссылки манифеста не проверяет ни одна проверка: `check-l10n` сверяет только паритет ключей, а `manifest-contract.test.ts` — только описания цветов
- **mechanism**: защищаемое поведение 03-D — «строки манифеста доходят до пользователя локализованными». `runCheck` сравнивает множество ключей `package.nls.json` ↔ `package.nls.ru.json`, но не проверяет, что каждая `%ссылка%` в `package.json` разрешается в существующий ключ. `manifest-contract.test.ts` умеет проверять разрешение `%key%`, но делает это только для `description` вкладов `colors`. Удаление ключа из обоих nls-файлов (или опечатка в ссылке при переименовании) оставляет обе проверки зелёными, а пользователь видит литерал `%command.refresh.title%`. Это и есть запрошенный класс «проверка проходит при удалённом защищаемом поведении».
- **trigger**: воспроизводится в нормальной работе (правка манифеста/nls — штатная операция последующих этапов 04-06, которые добавляют команды и меню)
- **in_scope**: да
- **anchor**: `tools/check-l10n.ts:264-284` (Channel 1)
- **evidence**:
  ```ts
  const manifestEn = readJsonRecord(PACKAGE_NLS_EN);
  const manifestRu = readJsonRecord(PACKAGE_NLS_RU);
  const manifestDiff = diffKeySets(Object.keys(manifestEn), Object.keys(manifestRu));
  ```
  Второй источник: `manifest-contract.test.ts` проверяет только `colors[].description` (`points every color description at an NLS key that exists`), прочие `%…%` манифеста не читает никто.
- **verification**: confirmed
- **verification_note**: просмотрены обе проверки целиком; ни одна не проходит по `%…%` ссылкам `views`/`commands`/`configuration`/`viewsWelcome`. Текущие ссылки валидны — дыра в покрытии, а не в текущем состоянии.
- **fix_direction**: расширить контрактный тест манифеста на все `%ключ%`-ссылки `package.json` против `package.nls.json`, а не только на описания цветов.

---

### qwen-05

- **reviewer**: qwen
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: Guard запуска `check-l10n.ts` — строковое сравнение URL с сырым путём: на Windows и на путях с пробелами/спецсимволами инструмент молча не делает ничего
- **mechanism**: `main()` вызывается только при `import.meta.url === \`file://${process.argv[1]}\``. `import.meta.url` — percent-кодированный file-URL, `process.argv[1]` — сырой путь ОС. На Windows сравнение не сходится никогда (обратные слэши против `file:///C:/…`), на POSIX ломается любой путь, требующий кодирования (`%20` для пробела, `#`, не-ASCII). При несовпадении скрипт тихо завершается с кодом 0 — и `l10n:check`, и `l10n:generate` становятся no-op'ом: весь локализационный гейт `pnpm check` (шаг 8 канона) молча умирает без единой диагностике. Ни один тест `main()` не покрывает — `check-l10n.test.ts` испытывает только `extractRuntimeKeys`.
- **trigger**: только на рукотворном входе (checkout в каталоге с пробелами/спецсимволами; рабочая машина под Windows)
- **in_scope**: да
- **anchor**: `tools/check-l10n.ts:370-372`
- **evidence**:
  ```ts
  if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
    main();
  }
  ```
- **verification**: confirmed
- **verification_note**: механизм проверяется сравнением форм обоих значений; на текущих путях (Linux CI, macOS без пробелов) сравнение сходится, что согласуется с заявленным зелёным прогоном.
- **fix_direction**: сравнивать канонизованные пути (`fileURLToPath(import.meta.url)` против `path.resolve(process.argv[1])`) либо вынести CLI в отдельный файл-вход без guard'а.

---

### qwen-06

- **reviewer**: qwen
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Решение 03-A «реестр сбрасывается при смене правил или корней» не подключено: `invalidate`/`forget` обоих реестров вызываются только тестами
- **mechanism**: план 03-A прямо требует сброса `NodeRegistry` при смене корней/правил («без явной инвалидации это кэш без инвалидации»). `extension.ts` в этом раунде пересобирал граф, но при смене корней в `refreshFromSettings` ни `nodeRegistry.invalidate()`, ни `forget()` не вызываются — карта канонических узлов живёт до конца сессии. Сегодня последствия ограничены памятью (дерево рендерится из свежего результата обхода, утечка в UI невозможна), поэтому не выше MEDIUM; находка вне списка изменённых файлов по якорю, но механизм идентичен qwen-03, а отклонение от плана не записано в «Решения, изменённые при реализации».
- **trigger**: воспроизводится в нормальной работе (каждая смена `projectsTree.roots` оставляет узлы прежних корней в реестре до конца сессии)
- **in_scope**: нет
- **anchor**: контракт 03-A (`03-tree-view.md`, «реестр сбрасывается при смене правил или корней»)
- **evidence**:
  ```ts
  // registry.test.ts — единственные вызовы во всём репозитории:
  registry.forget(nodeKey('r1', 'a'));
  registry.invalidate();
  ```
- **verification**: confirmed
- **verification_note**: grep `\.(invalidate|forget)\(` по `src/**`: только `registry.test.ts:76,86`.
- **fix_direction**: сбрасывать реестры при изменении корней в `refreshFromSettings`, либо явно записать отсрочку в раздел «Решения, изменённые при реализации» — сейчас отклонение от плана не задокументировано.

---

### qwen-07

- **reviewer**: qwen
- **severity**: LOW
- **kind**: pattern
- **domain**: style
- **title**: Комментарии новых файлов описывают конфигурацию, которой не существует: «закреплённая версия» в CI и «tsconfig.test.json» в `.vscode-test.mjs`
- **mechanism**: Комментарий кэш-шага джобы обосновывает стратегию кэша «закреплённой `version` в `.vscode-test.mjs`» — но конфиг версию не задаёт, и `@vscode/test-cli` берёт `stable`: интеграционные тесты выполняются на движущейся сборке редактора, а кэш накапливает версии не «пока версия не сдвинется в конфиге», а пока не обновится `stable`. Второй экземпляр: комментарий `.vscode-test.mjs` ссылается на `tsconfig.test.json` с `rootDir "."` — реальность `test/tsconfig.json` с `rootDir ".."`, причём именно имя `tsconfig.test.json` AGENTS.md называет ломающим линт всего тестового дерева. Оба комментария переживут ближайшего читателя как «факты».
- **trigger**: недостижим (комментарии)
- **in_scope**: да
- **anchor**: `.github/workflows/ci.yml:77-83`; `packages/projects-tree/.vscode-test.mjs:22`
- **evidence**:
  ```yaml
  # build) is a ~300MB fetch that does not change between runs unless the pinned `version` in
  # `.vscode-test.mjs` moves — …
  ```
  ```js
  // tsconfig.test.json emits here (rootDir "." -> outDir "out", mirroring test/ and src/).
  ```
- **verification**: confirmed
- **verification_note**: в `.vscode-test.mjs` поля `version` нет (файл прочитан целиком); реальный путь и `rootDir` сверены с `test/tsconfig.json`.
- **fix_direction**: либо действительно закрепить версию редактора в конфиге (и этим же закрыть воспроизводимость интеграционных тестов), либо привести комментарий в соответствие с `stable`; имя тайт-конфига в комментарии исправить.

---

### qwen-08

- **reviewer**: qwen
- **severity**: LOW
- **kind**: contract
- **domain**: tests
- **title**: Тест читает `ThemeColor.id` обратно — вопреки записанному решению, принятому после факта 43
- **mechanism**: Раздел «Решения, изменённые при реализации» фиксирует: «`ThemeColor` конструируется на самом краю и никогда не читается обратно — ни в production, ни в тесте». `item.test.ts` нарушает букву: фейковый `ThemeColor` объявлен с публичным `id`, и тест утверждает `icon.color?.id`. Вреда на планке нет (мок, а не `@types/vscode`), но это нормализует ровно тот паттерн, за который факт 43 уже однажды наказал план, и расходится с собственным док-комментарием `decoration-provider.ts` («never introspected afterwards»).
- **trigger**: недостижим (тестовый фейк)
- **in_scope**: да
- **anchor**: контракт 03-tree-view.md «ThemeColor … никогда не читается обратно» против `packages/projects-tree/src/editor/tree-view/item.test.ts:156-158`
- **evidence**:
  ```ts
  const icon = item.iconPath as { id: string; color?: { id: string } };
  expect(icon.id).toBe('star');
  expect(icon.color?.id).toBe('projectsTree.highlight');
  ```
- **verification**: confirmed
- **verification_note**: в `decoration-provider.test.ts` тот же фейк `id` не читает (`color` только `toBeDefined()`); читает его только этот тест.
- **fix_direction**: утверждать цвет без чтения `id` (сравнение сконструированных фейк-экземпляров либо перехват аргумента конструктора), либо уточнить формулировку решения, что запрет касается только реального типа.

---

### qwen-09

- **reviewer**: qwen
- **severity**: LOW
- **kind**: point
- **domain**: style
- **title**: Факт 39 в `api-facts.md`: номера строк полей `TreeViewOptions` меньше номера строки самого интерфейса — ссылка невоспроизводима
- **mechanism**: Строка фактов цитирует интерфейс на `vscode.d.ts:11852`, а поля `treeDataProvider`/`showCollapseAll`/`canSelectMany`/`dragAndDropController` относит к строкам `:1855-1857`, `:1862`, `:1868`, `:1873` — на десять тысяч строк раньше интерфейса, очевидно потерянный префикс `11`. По правилу 4 самой таблицы строка без воспроизводимой команды/номера строки недействительна. Материального вреда нет: существование полей машинно подтверждается каждым `typecheck` против планки 1.85 (опции `createTreeView` компилируются), но таблица, введённая именно против непроверяемых ссылок, сама несёт непроверяемую ссылку.
- **trigger**: недостижим (документация)
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md:531-533`
- **evidence**:
  ```
  `vscode.d.ts:11852` (`export interface TreeViewOptions<T> {`) с полями `treeDataProvider`
  (`:1855-1857`), `showCollapseAll?: boolean` (`:1862`), `canSelectMany?: boolean` (`:1868`),
  ```
- **verification**: confirmed
- **verification_note**: внутренняя арифметика строки: ссылки на поля меньше строки объявления интерфейса и не могут лежать внутри него.
- **fix_direction**: переснять номера строк полей (вероятно `11855-11857` и далее) по скачанному источнику, как того требует правило 4.

---

## Coverage — проверено и признано чистым

- **Проводка новых экспортируемых символов** (главная гипотеза раунда): `readLocation` и `setLocationContextKeys` (extension.ts), `locationContextKeys` (context-keys.ts), `ALL_VIEW_IDS`/`ExpansionStore`/`treeElementKey` (extension.ts), `toTreeItemLabel` (item.ts), `HighlightDecorationProvider` (extension.ts + provider.ts), `buildDecorationSpec`/`isBadgeWithinPlatformLimit` (внутри decoration-provider.ts) — все имеют производственные вызовы. Исключения — qwen-03 и (вне диффа) qwen-06.
- **Шов 03-B ↔ интеграционные тесты**: конструктор `ProjectsTreeProvider` с обязательным 7-м аргументом `isExpanded` — все четыре интеграционные сюиты передают его; компилятор шов держит.
- **`ExpansionStore` ↔ `TreeItem.id`**: ключ пишется и читается одной функцией `treeElementKey`; `item.id` в item.ts присваивается тем же значением; корневые группы — отдельный неймспейс `root:<rootId>`, совпадающий с обеих сторон (факты 27/41 соблюдены). `isExpanded` только поднимает дефолт до `Expanded` — ограничение записано в плане. Перенос раскрытия между двумя view механизму соответствует: в новом для узла view побеждает дефолт из `getTreeItem`.
- **Декорации**: бейдж считается в code points и в ядре (`[...highlight.badge].length > 2`, validation.ts:117), и в адаптере (`[...badge].length <= 2`) — единицы совпадают (закрытие codex-13 из round 05); сверхлимитный бейдж отбрасывается с сохранением цвета; пустой `DecorationSpec` никогда не становится `FileDecoration` (факт 7); `propagate = true` на каждой декорации, при изменении сигналятся и сам URI, и все предки (факт 9); безусловный `propagate` совпадает с записанным решением плана; пустые корни корректно гасят декорации (`update([])` в обеих ветках `refresh()`).
- **Поправка факта 43 полная**: в production-коде `ThemeColor` только конструируется, `colorId` живёт строкой, нигде не читается обратно; запись в таблице опровергнутых добавлена (единственное исключение — тестовый фейк, см. qwen-08).
- **Два view**: разные id; `activationEvents`, `viewsWelcome`, `view/title`-меню продублированы на оба id (сверено и глазами в манифесте, и `manifest-contract.test.ts`); режим `none` гасит оба ключа; провайдер зарегистрирован на оба id безусловно (записанное решение); поле `l10n` в манифесте есть (факт 19); `contributes.colors` несёт дефолты для всех четырёх тем.
- **Локализация**: `check` ре-экстрагирует ключи из AST на каждом запуске, а не читает свой же генерат; нелитеральные первые аргументы `l10n.t` (шаблон с интерполяцией, переменная, объект с нелитеральным `message`, отсутствие аргументов) дают громкую ошибку, а не тихий пропуск; три вызова `l10n.t` в `src/**` в точности равны ключам обоих бандлов; паритет `package.nls.json` ↔ `package.nls.ru.json` полный; суффикс `/<comment>` строится по факту 49.
- **Четыре новых самопроверяющих инструмента**: `check-chain.test.ts` сверяет два независимых источника (AGENTS.md ↔ `scripts.check`) с защитой от пустого парсинга; `compat-floor.test.ts` сверяет `engines.vscode` ↔ точный пин `@types/vscode` ↔ единственное разрешение в lockfile; `manifest-contract.test.ts` сверяет манифест с константами кода (а не константы с самими собой); `check-l10n` — см. выше. Каждый падает при удалении защищаемого поведения — кроме оговорённых в qwen-04/qwen-05 дыр.
- **Интеграционные сюиты**: `refresh-identity` действительно краснеет при поломке `canonicalize` (проверено мысленно по описанному сценарию ломки); `resilience` покрывает удаление ветки и корня целиком; `discovery` — классификацию на реальной ФС; `temp-tree` — не сюита (глоб `*.test.js` его не матчит), комментарий это объясняет.
- **Механизмы M1-M6 раунда 05 в этом диффе не воспроизведены**: глобы/регулярки не тронуты; диагностика экстрактора громкая; отмена не в скоупе; бейдж по code points; квотирование не в скоупе.
- **Прочее**: `eslint.config.mjs` (`**/.vscode-test/**`) и `knip.json` (`ignoreDependencies: ["@vscode/test-electron"]`) соответствуют канону AGENTS.md; `xvfb-run -a` — только Linux-джоба (факт 55); `node -e "fs.rmSync(…)"` в `test:integration` опирается на глобальный `fs` в `-e` — работает на Node 26 (engines/.nvmrc), на старшем Node упало бы громко, тихого риска нет; имя `test/tsconfig.json` — то, которое требует AGENTS.md; тест `check-l10n.test.ts` с названием «skips nested directories…» на деле проверяет рекурсивный обход вложенных каталогов (ключ `'Nested'` извлекается) — поведение верное, название вводит в заблуждение.

## Отклонённые находки (refuted)

| id | title | причина |
|---|---|---|
| qwen-r01 | Единицы подсчёта бейджа расходятся между ядром и адаптером | опровергнуто: оба считают `[...s].length` — code points |
| qwen-r02 | Ключ записи раскрытия не совпадает с `TreeItem.id`, фича молча не работает | опровергнуто: обе стороны используют `treeElementKey`, включая `root:<rootId>` |
| qwen-r03 | `check-l10n` сравнивает против собственного генерата и всегда зелёный | опровергнуто: `check` ре-экстрагирует из исходников и сверяет также значения базового бандла |
| qwen-r04 | `propagate` сигналит только сам узел, предки не переспрашиваются | опровергнуто: `toSignal` включает URI и всю цепочку предков, при удалении узла — из предыдущего состояния |
| qwen-r05 | Режим `none` оставляет один из двух view видимым | опровергнуто: `locationContextKeys('none')` — оба `false`; покрыто юнит- и контрактным тестами |
| qwen-r06 | Экстрактор молча пропускает нелитеральные аргументы `l10n.t` | опровергнуто: все такие формы попадают в `errors` и роняют exit-код; покрыто тестами |
| qwen-r07 | Production-код всё ещё читает `ThemeColor.id` после правки факта 43 | опровергнуто: читает только тестовый фейк (вынесено в qwen-08 как LOW) |
| qwen-r08 | `viewsWelcome`/меню/`activationEvents` не продублированы на второй view | опровергнуто: манифест несёт дубли; сверка автоматизирована `manifest-contract.test.ts` |
| qwen-r09 | Раскрытие не переносится между двумя view | опровергнуто: для «нового» в данном view узла побеждает дефолт `getTreeItem` (факт 41), который `isExpanded` поднимает до `Expanded` — механизм ровно тот, что заявлен |
| qwen-r10 | Прямая зависимость `mocha@^12` неиспользуется (`@vscode/test-cli` тянет свою) | не подтверждено и не опровергнуто: без запуска `knip` неразрешимо; заявлен зелёным, вероятное объяснение — `types: [..., "mocha"]` в `test/tsconfig.json` |
