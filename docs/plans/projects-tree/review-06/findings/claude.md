# Находки — claude (round 06, этап 03 ProjectsTree)

Материал: committed HEAD `342fb31` (диапазон `ad7bb67..HEAD`). **Рабочее дерево по ходу ревью
перестало быть чистым** — в нём появились правки `registry.ts`/`expansion.ts`/`provider.ts`/
`extension.ts`/`item*.ts`/`manifest-contract.test.ts`/`api-facts.md`/`package.json` и трёх
интеграционных тестов (видимо, закрытие qwen-03/qwen-06: `treeElementKey` и `retainOnly`
переезжают в `registry.ts` и вызываются из `provider.ts`). Все находки ниже перепроверены против
`git show HEAD:<path>`, а не против рабочего дерева.

---

### claude-01

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: reliability
- **title**: Дубликат пути в `projectsTree.roots` кладёт в дерево один и тот же объект дважды как соседей и даёт два узла с одинаковым `TreeItem.id` — ни один слой не дедуплицирует корни
- **mechanism**: `id` корня — это его путь (`settings.ts:parseRootEntry`: `{ id: value, path: value }`). `readRoots` не дедуплицирует; `mergeRoots` дедуплицирует только «новое против существующего» и **прямо документирует**, что существующие записи «never reordered or deduplicated against each other»; `buildTopLevel` тоже не дедуплицирует. Дальше два одинаковых `ConfiguredRoot` дают один и тот же `rootId`, поэтому: (а) в режиме группировки `groupRegistry.canonicalize(root.id, …)` на обеих итерациях `roots.map(...)` возвращает **один и тот же** `RootGroupNode`, и `#topLevel` содержит его дважды; (б) без группировки `discoverProjectTree` обходит один и тот же каталог дважды, `nodeKey(rootId, pathFromRoot)` совпадает, и `nodeRegistry.canonicalize` тоже отдаёт один объект дважды. В обоих случаях `getChildren()` возвращает массив, где один и тот же объект стоит на двух позициях, а `toTreeItem` присваивает им одинаковый `item.id`. Это ломает сразу две зафиксированные посылки: факт 4 (`_nodes: Map<T, TreeNode>` — на объект приходится ровно один узел) и факт 27 («Optional id for the tree item that has to be unique across tree»).
- **trigger**: воспроизводится в нормальной работе — достаточно, чтобы в `projectsTree.roots` дважды оказался один путь; настройка правится руками (её `oneOf`-схема, по комментарию `add-root.ts`, вынуждает Settings UI уйти в «Edit in settings.json»), и ни валидация записи, ни warning про `invalid` этого не отвергают
- **in_scope**: да — `extension.ts`, `provider.ts`, `top-level.ts` в диффе; `settings.ts` изменён этим же диапазоном
- **anchor**: `packages/projects-tree/src/editor/tree-view/top-level.ts:29-34` (+ `src/editor/configuration/settings.ts:49-53`, `src/editor/tree-view/provider.ts:76-82`)
- **evidence**:
  ```ts
  return roots.map((root) => {
    const children = nodes.filter((node) => node.facts.rootId === root.id);
    const label = root.label ?? nodePath.basename(root.path);
    return groupRegistry.canonicalize(root.id, label, children);
  });
  ```
  ```ts
  // merge-roots.ts, докстринг mergeRoots:
  // `existing` entries are carried through unchanged … and never reordered or
  // deduplicated against each other; only new-vs-existing and new-vs-new duplicates are dropped.
  ```
- **verification**: confirmed
- **verification_note**: цепочка прочитана целиком по HEAD: `parseRootEntry` → `id = path`; `RootGroupRegistry.canonicalize` (`registry.ts:69-88`) возвращает `existing` для уже известного `rootId`; `buildTopLevel` вызывает его по одному разу на каждую запись `roots`, не сводя записи по `id`. `top-level.test.ts` покрывает шесть кейсов (`grep 'it('`), ни один не подаёт два корня с одинаковым путём; `settings.test.ts`/`merge-roots.test.ts` дубликат в существующем массиве тоже не подают. Живой прогон в редакторе не делался (read-only ревью), поэтому «как именно платформа деградирует» — не проверено; проверено, что нарушаются посылки фактов 4 и 27, на которые опирается вся идентичность узлов в 03-A.
- **fix_direction**: свести корни по `id` в одном месте на входе — там, где настройка превращается в `ConfiguredRoot[]` (тогда и `invalid`-репортинг может сказать пользователю про отброшенный дубликат), а не в трёх потребителях; добавить в набор входов для `buildTopLevel`/`readRoots` форму «два одинаковых пути» и, отдельно, «два разных пути, один вложен в другой».

---

### claude-02

- **reviewer**: claude
- **severity**: HIGH
- **kind**: point
- **domain**: reliability
- **title**: Аллоулист `tools/check-vsix-contents.ts` не обновлён под файлы, добавленные этапом 03 — джоба публикации падает на любом релизе; проверено `vsce ls`
- **mechanism**: `check-vsix-contents.ts` сравнивает содержимое собранного `.vsix` с закрытым списком **на точное равенство множеств** (`unexpected` = всё, чего нет в `ALLOWLIST`, и любой непустой `unexpected` → `process.exit(1)`). Этап 03 добавил в упаковываемый набор четыре новых файла, ни один из которых в аллоулисте не появился: `package.nls.ru.json` и `l10n/bundle.l10n.ru.json` (пакет 03-D — они обязаны быть в пакете), а также `.vscode-test.mjs` и `test/tsconfig.json` (интеграционные тесты; `.vscodeignore` их не исключает — см. claude-04). Проверка не входит ни в `pnpm check`, ни в `ci.yml` — она вызывается только из `publish.yml:56`, поэтому «зелёный `pnpm check` + зелёный CI» её состояние не отражают вовсе, и дефект выяснится в момент выкатки релиза.
- **trigger**: воспроизводится в нормальной работе — первый же запуск `publish.yml` на текущем HEAD
- **in_scope**: да — файлы, ломающие проверку, добавлены этим диапазоном; сам аллоулист диффом не тронут, что и есть дефект
- **anchor**: `tools/check-vsix-contents.ts:11-20` (+ `.github/workflows/publish.yml:56`)
- **evidence**:
  ```ts
  const ALLOWLIST: readonly string[] = [
    'package.json', 'readme.md', 'LICENSE.txt', 'l10n/bundle.l10n.json',
    'dist/extension.js', 'schemas/rules.schema.json', 'package.nls.json',
    'media/activity-icon.svg',
  ];
  ```
- **verification**: confirmed
- **verification_note**: фактический набор снят командой, которую можно повторить —
  `cd packages/projects-tree && npx vsce ls --no-dependencies`:
  `package.nls.ru.json, package.nls.json, package.json, README.md, LICENSE, .vscode-test.mjs,
  test/tsconfig.json, media/activity-icon.svg, l10n/bundle.l10n.ru.json, l10n/bundle.l10n.json,
  schemas/rules.schema.json, dist/extension.js`. За вычетом нормализаций, которые аллоулист учитывает
  (`README.md`→`readme.md`, `LICENSE`→`LICENSE.txt`), в `unexpected` попадают ровно четыре записи:
  `package.nls.ru.json`, `l10n/bundle.l10n.ru.json`, `.vscode-test.mjs`, `test/tsconfig.json`.
- **fix_direction**: внести в аллоулист два файла локализации (они часть полезной нагрузки) и убрать из пакета тестовую оснастку через `.vscodeignore` (claude-04), а не через аллоулист; отдельно — решить, почему проверка упаковки живёт только в `publish.yml` при явном запрете AGENTS.md «добавлять проверку в CI, не заводя её в `pnpm check`»: пока это так, любое изменение упаковываемого набора обнаруживается только релизом.

---

### claude-03

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: Два одновременных `refresh()` не упорядочены — победителем становится тот, кто финишировал позже, а не тот, кто стартовал позже; `CancellationSource` заводится на проход и никем не отменяется
- **mechanism**: `ProjectsTreeProvider.refresh()` асинхронен (`await discoverProjectTree(...)`), заводит **локальный** `new CancellationSource()` и после await безусловно перезаписывает `#topLevel`, кормит `decorations.update` и стреляет `#emitter.fire(undefined)`. Ни счётчика генерации, ни отмены предыдущего прохода нет. Вызовов при этом три независимых: `onTreeConfigurationChanged(() => void refreshFromSettings())`, команда `projectsTree.refresh` и активация. Пример достижимой последовательности: пользователь сохраняет `settings.json` с новыми корнями (проход A стартует), тут же жмёт Refresh (проход B стартует); если A завершается позже B, дерево и декорации остаются от **старого** набора корней до следующего обновления. То же для `projectsTree.addRoot`, который пишет настройку и тем самым запускает проход поверх возможного текущего.
- **trigger**: воспроизводится в нормальной работе — окно тем шире, чем больше корни; на медленном диске/сетевой ФС обход занимает секунды
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/tree-view/provider.ts:64-83`
- **evidence**:
  ```ts
  const cancellation = new CancellationSource();
  const result = await discoverProjectTree(roots, this.rules, this.fs, cancellation.signal);
  const canonicalNodes = result.nodes.map((node) => this.nodeRegistry.canonicalize(node));
  this.#topLevel = buildTopLevel(canonicalNodes, roots, this.getShowRootNodes(), this.groupRegistry);
  ```
- **verification**: confirmed
- **verification_note**: в `provider.ts` нет ни одного поля, хранящего текущий проход или его номер (`grep -n "#" provider.ts` — только `#emitter` и `#topLevel`); `cancellation` — локальная переменная, `cancel()` по коду не вызывается нигде (`git grep -n "\.cancel(" HEAD -- packages/projects-tree/src` даёт только тесты ядра). Ни один тест в диффе не запускает два `refresh()` без `await` между ними — все интеграционные и юнит-вызовы строго последовательные.
- **fix_direction**: сделать проход отменяемым и отменять предыдущий при старте нового (`CancellationSource` уже есть, ему нужен владелец на уровне поля), либо ввести монотонный номер прохода и игнорировать результат устаревшего перед записью в `#topLevel`; закрыть регрессионным тестом на два неупорядоченных `refresh()`.

---

### claude-04

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: deps
- **title**: `.vscode-test.mjs` и `test/tsconfig.json` попадают внутрь публикуемого расширения — `.vscodeignore` их не исключает
- **mechanism**: `.vscodeignore` исключает `src/**`, `**/*.ts`, `tsconfig.json`, `tsconfig.*.json`, `.vscode-test/**`. Ни один из этих шаблонов не покрывает `.vscode-test.mjs` (это файл, а не каталог `.vscode-test/`) и `test/tsconfig.json` (шаблон `tsconfig.json` без `**/` матчит только корень; `tsconfig.*.json` — только имена с суффиксом). В результате конфиг тестового раннера и tsconfig тестов уезжают пользователю внутри `.vsix`.
- **trigger**: воспроизводится в нормальной работе — любая упаковка (`pnpm --filter projects-tree package`, шаг «Package projects-tree» в `ci.yml`)
- **in_scope**: да — оба файла добавлены этим диапазоном
- **anchor**: `packages/projects-tree/.vscodeignore` (полный файл, 14 строк) + `packages/projects-tree/.vscode-test.mjs`, `packages/projects-tree/test/tsconfig.json`
- **evidence**:
  ```
  .vscode-test/**
  ...
  tsconfig.json
  tsconfig.*.json
  **/*.ts
  ```
  `npx vsce ls --no-dependencies` → в списке присутствуют `.vscode-test.mjs` и `test/tsconfig.json`.
- **verification**: confirmed
- **verification_note**: проверено тем же прогоном `vsce ls`, что и claude-02 — оба файла в выводе. Ущерб для пользователя ограничен размером и «мусором в пакете» (эти файлы ничего не исполняют внутри редактора), поэтому не выше MEDIUM; практический эффект сегодня — красная джоба публикации (claude-02).
- **fix_direction**: добавить в `.vscodeignore` шаблоны, покрывающие тестовую оснастку целиком (`test/**`, `.vscode-test.mjs`, `**/tsconfig*.json`), и убедиться, что после этого `check-vsix-contents.ts` даёт ровно полезную нагрузку.

---

### claude-05

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: architecture
- **title**: Декорации ключуются абсолютным путём, тогда как ядро ключует `rootId` + путь именно потому, что корни могут пересекаться — при пересечении корней узлы молча склеиваются
- **mechanism**: `registry.ts` явно объясняет, почему ключ — `rootId` + путь: «two configured roots can overlap on disk, and a path-only key would collide their nodes». `HighlightDecorationProvider.collect` при этом ключует запись `uri.toString()`, то есть **только путём**, а `update` собирает из этих записей `new Map(...)` дважды (`nextState` и `#decorations`). При пересекающихся корнях (`/dev` и `/dev/work`) один и тот же каталог присутствует в дереве дважды с потенциально разными вердиктами — в оба Map попадает только последняя запись, без диагностики; какая именно — зависит от порядка корней в настройке. Дополнительно диффер сравнивает `previous?.spec` и `next?.spec` для склеенного ключа, поэтому смена вердикта «не выигравшей» ветки не сигналится вовсе.
- **trigger**: воспроизводится в нормальной работе — вложенные корни настройка допускает и никак не отвергает (ни `readRoots`, ни `mergeRoots` не проверяют вложенность)
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/decorations/decoration-provider.ts:110-121` и `:145-155`
- **evidence**:
  ```ts
  const uri = vscode.Uri.file(element.facts.absolutePath);
  out.push({ key: uri.toString(), uri, spec: buildDecorationSpec(...), ancestorUris });
  ```
  ```ts
  const nextState = new Map(entries.map((entry) => [entry.key, entry]));
  ```
- **verification**: confirmed
- **verification_note**: `FileDecorationProvider` по своей сигнатуре адресуется URI (факт 8), поэтому «ключевать по `NodeKey`» здесь в принципе нельзя — дефект не в выборе ключа, а в том, что коллизия не названа и не обработана: ни докстринг файла (он подробно разбирает `propagate`, `resourceUri` и бейджи), ни `decoration-provider.test.ts` (18 кейсов, ни одного с двумя узлами на одном `absolutePath`) пересечение корней не рассматривают. Живой прогон не делался.
- **fix_direction**: назвать коллизию в докстринге провайдера и выбрать детерминированное правило слияния (например, объединять спеки узлов с одним URI по явному приоритету), либо запретить пересекающиеся корни на входе (тогда это станет ответственностью `configuration/`, и решение будет одно на весь адаптер); в любом случае добавить в набор входов декораций «два узла с одинаковым `absolutePath` и разными вердиктами».

---

### claude-06

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Ключевое решение 03-C («регистрируем провайдер на оба view безусловно») опирается на два утверждения об API VS Code, которых в `api-facts.md` нет
- **mechanism**: `location.ts` обосновывает безусловную регистрацию так: «Registering a provider for a view hidden by its `when` costs nothing: the platform never asks a hidden view for children». Это утверждение о поведении платформы, и строки под него в таблице нет: факт 5 говорит только про уникальность id и `onView:<id>`; факт 39 — про существование `createTreeView`; факт 47 — про `hideIfEmpty` контейнера, не про опрос скрытого view. Второе неподтверждённое утверждение — что один экземпляр `TreeDataProvider` допустимо отдать сразу двум `TreeView` с разными id (`extension.ts` делает именно это: `ALL_VIEW_IDS.flatMap(...)` с общим `provider`), и что события `onDidExpandElement` от двух view можно писать в одно хранилище раскрытий. Ни того, ни другого в таблице нет. AGENTS.md запрещает это прямо: «Stating a VS Code API behavior as a basis for a decision without a quoted row in `api-facts.md`».
- **trigger**: недостижим как баг сам по себе — это нарушение канона; наблюдаемое следствие (лишний обход при скрытом view) описано отдельно в claude-10
- **in_scope**: да
- **anchor**: контракт «api-facts.md» (AGENTS.md, разделы «api-facts.md» и «Prohibited»); места — `packages/projects-tree/src/editor/tree-view/location.ts:35-43`, `packages/projects-tree/src/extension.ts:68-88`
- **evidence**:
  ```ts
  /**
  Both view ids, always. … Registering a provider for a view hidden by its `when` costs nothing: the
  platform never asks a hidden view for children.
  */
  export const ALL_VIEW_IDS: readonly string[] = [ACTIVITY_BAR_VIEW_ID, EXPLORER_VIEW_ID];
  ```
- **verification**: confirmed
- **verification_note**: прочитаны все 58 строк `api-facts.md`; `grep -n "hidden\|скрыт" docs/plans/projects-tree/api-facts.md` даёт только факт 47 (иконка контейнера) и новый факт 57 (view со ложным `when` нельзя раскрыть) — ни одна строка не утверждает, что скрытый view не опрашивается, и ни одна не касается двух `TreeView` на одном провайдере. Заметьте: факт 57, добавленный по ходу этапа, утверждает обратное по духу — что скрытый view «раскрыть нельзя», что как раз делает вопрос «а опрашивают ли его» существенным, а не риторическим.
- **fix_direction**: либо завести две строки в `api-facts.md` с дословными цитатами из источника (поведение `ExtHostTreeView`/`TreeViewPane` при скрытом `when`; допустимость общего провайдера на два view), либо переформулировать обоснование в `location.ts` так, чтобы оно не опиралось на непроверенное утверждение (например, свести его к стоимости, которая измерима без цитаты).

---

### claude-07

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: `.vscode-test.mjs` строит `launchArgs` на незаписанном утверждении о рантайме (лимит 103 символа на путь Unix-сокета) и решает его фиксированным общим путём `/tmp/pt-vscode-test`
- **mechanism**: комментарий конфига обосновывает переопределение `--user-data-dir` так: «The editor opens a Unix domain socket inside its --user-data-dir, and the kernel caps that path at 103 characters». Область таблицы `api-facts.md` расширена ревизией 4 именно на поведение рантайма (факты 25, 26), но строки под этот лимит нет — а решение (нестандартный `--user-data-dir`) висит целиком на нём. Отдельно от канона: выбранное значение — **фиксированный** путь `/tmp/pt-vscode-test`, одинаковый для всех прогонов и всех пользователей машины. Два параллельных прогона (локальный прогон + прогон в другом чекауте; матрица джоб на одном раннере) делят один каталог user-data и портят состояние друг друга; на общей машине каталог, созданный другим пользователем, сделает запуск редактора невозможным по правам.
- **trigger**: воспроизводится в нормальной работе для параллельных прогонов на одной машине; на CI сегодня один раннер и один прогон — то есть отказ отложенный, а не текущий
- **in_scope**: да — файл добавлен этим диапазоном
- **anchor**: `packages/projects-tree/.vscode-test.mjs:8-19`
- **evidence**:
  ```js
  const userDataDir =
    process.platform === 'win32'
      ? nodePath.join(nodeOs.tmpdir(), 'projects-tree-vscode-test')
      : '/tmp/pt-vscode-test';
  ```
- **verification**: confirmed
- **verification_note**: `grep -n "103\|sun_path\|user-data-dir\|socket" docs/plans/projects-tree/api-facts.md` — ни одного совпадения; сам лимит (`sun_path` в `sockaddr_un`) правдоподобен и на macOS/Linux действительно 104 байта, но по правилам таблицы правдоподобие не заменяет цитату из скачанного источника. Коллизия параллельных прогонов проверена чтением: путь не содержит ни pid, ни `mkdtemp`-суффикса, ни имени чекаута.
- **fix_direction**: записать лимит строкой `api-facts.md` с дословной цитатой источника (заголовок ядра или POSIX-спека) и сделать каталог уникальным на прогон, оставив его коротким, — уникальность важнее читаемого имени, потому что именно она отделяет два одновременных прогона.

---

### claude-08

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: `manifest-contract.test.ts` сверяет `when` только для `locationIs*`; `projectsTree.hasRoots` и оба id команд остаются несвязанными строковыми литералами в манифесте и в коде
- **mechanism**: файл написан ровно против этого класса отказа («a `when` clause names a context key as a string … A rename on either side shows the user no tree at all, and no other test in the suite sees it»), и для `locationIsActivityBar`/`locationIsExplorer` действительно сверяет манифест с `locationContextKeys(...)`. Но `viewsWelcome[].when` (`!projectsTree.hasRoots`) не сверяется ни с чем: ключ существует как литерал в `package.json` дважды и как `ROOTS_CONTEXT_KEY` в `context-keys.ts` — связи между ними нет ни в типах, ни в тестах. То же для команд: `projectsTree.refresh` и `projectsTree.addRoot` живут литералами в `contributes.commands`, в двух `menus.view/title`, в тексте `viewsWelcome` обоих `package.nls*.json` и в приватных константах `refresh.ts`/`add-root.ts` — пять-шесть независимых копий, ни одна не проверяется против другой. Переименование любой из них даёт молчаливую деградацию: welcome-экран не появляется, кнопка тулбара ничего не делает.
- **trigger**: воспроизводится в нормальной работе при следующем переименовании — тот же сценарий, против которого файл и написан
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/tree-view/manifest-contract.test.ts:58-66` (тест сверки `when`) — в нём перебираются только `declaredViews`, не `viewsWelcome`/`menus`
- **evidence**:
  ```ts
  const settableKeys = new Set(Object.keys(locationContextKeys('activityBar')));
  for (const view of declaredViews) { … expect(settableKeys).toContain(view.when); }
  ```
  ```
  # git grep 'projectsTree.hasRoots' HEAD:
  package.json:84,89        "when": "!projectsTree.hasRoots"
  src/editor/context-keys.ts:16   const ROOTS_CONTEXT_KEY = 'projectsTree.hasRoots';
  ```
- **verification**: confirmed
- **verification_note**: `git grep -n "projectsTree.hasRoots\|projectsTree.refresh\|projectsTree.addRoot" HEAD -- packages tools` — вывод приведён в evidence; ни один тест диффа не читает `viewsWelcome[].when` и не читает `contributes.commands[].command`, тест `duplicates viewsWelcome and view/title menus onto both views` проверяет только поле `view`/`when == "view == <id>"`, но не имя команды.
- **fix_direction**: расширить существующий контрактный тест на два оставшихся вида ссылок (context key из `viewsWelcome`, имена команд из `commands`/`menus`/текста welcome) — и в коде экспортировать эти идентификаторы из одного места, чтобы тест сверял манифест с экспортом, а не с копией литерала.

---

### claude-09

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: tests
- **title**: Два интеграционных теста проходят при удалённом поведении, которое они называют: `activation.test.ts` — при вырезанной регистрации обоих view, `location.test.ts` — при вырезанном выставлении context keys
- **mechanism**: `activation.test.ts` состоит из (а) чтения `contributes.views` из `extension.packageJSON` — это проверка `package.json` против самого себя, кода она не касается; (б) `await extension.activate(); assert.equal(extension.isActive, true)`. Если из `extension.ts` удалить весь блок `ALL_VIEW_IDS.flatMap(...)` (то есть перестать создавать оба `TreeView` и подписываться на раскрытие), активация по-прежнему завершится успешно и тест останется зелёным. Собственный комментарий теста это фактически признаёт («this assertion proves activation completed without error … not that a bad id is rejected»), но название теста обещает, что оба id «contributed and the extension activates cleanly», и в отчёте о покрытии он читается как проверка регистрации. Интеграционный `location.test.ts` устроен так же: он пишет настройку, читает её обратно и проверяет `isActive === true`. Удаление `setLocationContextKeys` целиком, удаление `setHasRoots`, удаление подписки `onTreeConfigurationChanged` — ни одно из этих изменений тест не покраснит. Его docstring предлагает как evidence «дошли до конца теста, значит reload не случился», но в реализации нет ни одного пути, который мог бы вызвать reload, — то есть аргумент защищает от опасности, которой в коде нет, а DoD 03-C («все три режима работают») не покрыт вообще ничем автоматическим.
- **trigger**: воспроизводится в нормальной работе — на следующем изменении, задевшем регистрацию view или context keys
- **in_scope**: да
- **anchor**: `packages/projects-tree/test/integration/activation.test.ts:32-34` и `packages/projects-tree/test/integration/location.test.ts:29-44`
- **evidence**:
  ```ts
  await extension.activate();
  assert.equal(extension.isActive, true);
  ```
  ```ts
  await vscode.workspace.getConfiguration(SECTION).update('location', location, ...);
  assert.equal(vscode.workspace.getConfiguration(SECTION).get('location'), location);
  assert.equal(vscode.extensions.getExtension(extensionId)?.isActive, true);
  ```
- **verification**: confirmed
- **verification_note**: сломать поведение и прогнать `test:integration` в живом редакторе фасилитатором не делалось (read-only ревью, среда без редактора) — вывод сделан по коду: ни один ассерт этих двух файлов не читает результат работы `createTreeView`/`setContext`, а `isActive` в тестовом хосте, где в манифесте теперь стоит `onStartupFinished`, к моменту первого ассерта истинно и без явного `activate()`. Заметьте асимметрию: `refresh-identity.test.ts` в том же каталоге несёт в docstring **инструкцию, как его покраснить** («break `NodeRegistry.canonicalize` — … make it return `{ ...node, children }` unconditionally»), и это ровно то, чего нет у этих двух.
- **fix_direction**: дать этим двум тестам наблюдаемый выход, который исчезает вместе с поведением: для активации — что-то, что существует только благодаря `createTreeView` (например, реакция на раскрытие узла, записанная в `globalState`); для размещения — проверять эффект context key там, где он наблюдаем через API (видимость/фокус view), либо честно понизить их до «дымовых» и снять с них зачёт DoD 03-C, назвав режимы непокрытыми.

---

### claude-10

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: performance
- **title**: `onStartupFinished` заставляет каждое окно обходить все корни, в том числе когда пользователь выбрал `location: 'none'`
- **mechanism**: `activate()` безусловно вызывает `void refreshFromSettings()`, а тот безусловно `await provider.refresh()` — полный обход всех корней до `maxDepth`. С добавлением `onStartupFinished` (правильно добавленным — см. факты 56-58) это происходит в каждом окне редактора, независимо от `projectsTree.location`. В режиме `none` оба view скрыты `when`, дерево не показывается никому, а обход всё равно выполняется, и его результат кладётся в `#topLevel`, в `NodeRegistry` и в декорации (последние, по факту 8, глобальны и продолжают краситься в Explorer — то есть в режиме «нигде» пользователь всё-таки видит эффект расширения). Замер в факте 57 (18 мс на 181 узле) снимался на конкретном дереве и потолком не является: обход синхронно читает каталоги через `node:fs` в каждом окне.
- **trigger**: воспроизводится в нормальной работе — каждое открытие окна у пользователя, поставившего `location: 'none'` или просто не открывающего дерево
- **in_scope**: да — `activationEvents` и `refreshFromSettings` изменены этим диапазоном
- **anchor**: `packages/projects-tree/src/extension.ts:43-58` (+ `packages/projects-tree/package.json:32-36`)
- **evidence**:
  ```ts
  await setLocationContextKeys(readLocation());
  await setHasRoots(roots.length > 0);
  await provider.refresh();
  ```
- **verification**: confirmed
- **verification_note**: `readLocation()` в `refreshFromSettings` читается только чтобы выставить context keys; его значение нигде не влияет на то, делать ли обход. Ни один тест не проверяет, что в режиме `none` обход не выполняется. Обратная сторона очевидна и её надо взвесить при фиксе: context keys выставлять обязательно всегда (иначе возвращается круг из факта 57), а вот обход — нет.
- **fix_direction**: развести две обязанности `refreshFromSettings`: выставление context keys оставить безусловным, а обход выполнять только если дерево где-то показывается (и запускать его при переключении `location` из `none`); закрыть тестом «в режиме `none` `listRoots` не вызывается».

---

### claude-11

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: reliability
- **title**: Предупреждение о некорректных записях `projectsTree.roots` показывается заново на каждое изменение любой из трёх настроек и на каждой активации, без дедупликации
- **mechanism**: `refreshFromSettings` вызывает `readRoots()` и при непустом `invalid` безусловно показывает `showWarningMessage`. Подписка `onTreeConfigurationChanged` срабатывает на изменение `roots`, `showRootNodes` **или** `location`. Значит пользователь с одной битой записью в `roots` получает тот же тост при каждом переключении размещения дерева и при каждом изменении группировки — то есть ровно тогда, когда он ковыряется в настройках и предупреждение уже видел. Плюс один тост на каждое открытие окна (теперь гарантированно, из-за `onStartupFinished`). Состояния «про это уже сказали» нет.
- **trigger**: воспроизводится в нормальной работе — одна опечатка в `roots` и любое дальнейшее изменение настроек расширения
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/extension.ts:44-51`
- **evidence**:
  ```ts
  const { roots, invalid } = readRoots();
  if (invalid.length > 0) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t('Ignoring {0} invalid entry/entries in projectsTree.roots — …', invalid.length),
    );
  }
  ```
- **verification**: confirmed
- **verification_note**: `onTreeConfigurationChanged` (`settings.ts:104-114`) фильтрует по трём секциям и вызывает слушателя одним и тем же способом для всех трёх; `refreshFromSettings` — единственный слушатель. Никакого запоминания показанного предупреждения ни в `extension.ts`, ни в `settings.ts` нет.
- **fix_direction**: показывать предупреждение только когда состав `invalid` изменился (или только при изменении самой настройки `roots`), а не на любой проход; альтернатива, которая часто лучше тоста, — оставить постоянный след там, где он не требует дедупликации (сообщение view/лог), и не дублировать его в модальный канал.

---

### claude-12

- **reviewer**: claude
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: Экстрактор `check-l10n` молча пропускает любое непрямое обращение к `l10n.t` — при обещании в шапке файла падать громко
- **mechanism**: шапка `check-l10n.ts` обещает: «Extraction failure is loud, not silent … makes `generate`/`check` exit non-zero rather than skip the call — a silently dropped key is exactly the failure this tool exists to prevent». Но громко экстрактор падает только на **аргументе** внутри уже распознанного вызова. Распознаётся при этом строго форма `<что-угодно>.l10n.t(...)` / `l10n.t(...)` (`isL10nTCall` требует `PropertyAccessExpression` с `name.text === 't'`, а `isLikeL10nNamespace` — идентификатор `l10n` либо доступ к члену с именем `l10n`). Всё остальное не даёт ни ключа, ни ошибки: `const { t } = vscode.l10n; t('msg')`, `const tr = vscode.l10n.t; tr('msg')`, `vscode.l10n['t']('msg')` (`ElementAccessExpression`), реэкспорт `export const t = vscode.l10n.t` из своего модуля. Каждая такая строка окажется в UI на английском при русской локали, а `pnpm check` останется зелёным — то есть ровно тот режим отказа, против которого инструмент написан. Тест `check-l10n.test.ts` эту границу закрепляет с другой стороны: кейс «ignores an unrelated `.t()` call that is not on an l10n namespace» проверяет, что `something.t(...)` **не** ошибка, — но `t(...)`, полученный из `l10n`, от `something.t(...)` синтаксически неотличим, и никакого барьера против первого нет.
- **trigger**: воспроизводится в нормальной работе — первая же деструктуризация или алиас `l10n.t` в новом файле; в текущем коде все три вызова написаны в распознаваемой форме, поэтому сегодня дефект латентный
- **in_scope**: да
- **anchor**: `tools/check-l10n.ts:57-77`
- **evidence**:
  ```ts
  function isL10nTCall(node: ts.CallExpression): boolean {
    const callee = node.expression;
    return (
      ts.isPropertyAccessExpression(callee) && callee.name.text === 't' &&
      isLikeL10nNamespace(callee.expression)
    );
  }
  ```
- **verification**: confirmed
- **verification_note**: код прочитан дословно; `ts.isElementAccessExpression` и `ts.isObjectBindingPattern` в файле не встречаются ни разу (`grep -n "ElementAccess\|BindingPattern\|isVariableDeclaration" tools/check-l10n.ts` — пусто), значит ни одна из перечисленных форм не может быть ни распознана, ни отвергнута. `check-l10n.test.ts` покрывает семь кейсов, все — про аргумент внутри распознанного вызова, ни один не подаёт непрямое обращение.
- **fix_direction**: закрыть дыру не в экстракторе, а барьером, который делает нераспознаваемую форму невозможной: запретить в `src/**` любое упоминание `l10n` кроме вызова `<ns>.l10n.t(` (lint-правило или отдельная проверка на «`l10n` встречается не в позиции вызова — ошибка»); привести обещание в шапке файла в соответствие с тем, что действительно проверяется.

---

### claude-13

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: deps
- **title**: Кэш редактора в CI с фиксированным ключом и без `restore-keys` никогда не перезаписывается, поэтому обоснование «новая версия просто добавит каталог под тем же ключом» неверно
- **mechanism**: шаг `actions/cache@v4` задаёт `key: ${{ runner.os }}-vscode-test-electron` без `restore-keys`. При точном совпадении ключа (cache hit) `actions/cache` **пропускает** post-шаг сохранения — то есть кэш пишется один раз, на первом прогоне, и после этого не обновляется никогда. Комментарий в `ci.yml` утверждает обратное: «a version bump simply adds a new version directory under the same cache key rather than invalidating it; the tradeoff is the cache slowly accumulating stale version directories». Ничего не накапливается: как только `stable` сдвинется, каждый прогон будет скачивать ~300 МБ заново и выбрасывать, а кэш останется с устаревшей версией навсегда. Отдельно — сам комментарий ссылается на «pinned `version` in `.vscode-test.mjs`», которого в файле нет (это уже отмечено как qwen-07).
- **trigger**: воспроизводится в нормальной работе — при первом же сдвиге канала `stable`
- **in_scope**: да
- **anchor**: `.github/workflows/ci.yml:84-88`
- **evidence**:
  ```yaml
  - name: Cache downloaded editor
    uses: actions/cache@v4
    with:
      path: packages/projects-tree/.vscode-test
      key: ${{ runner.os }}-vscode-test-electron
  ```
- **verification**: confirmed
- **verification_note**: подтверждается чтением конфигурации (нет `restore-keys`, ключ не зависит ни от чего изменяемого) плюс документированная семантика `actions/cache`: при cache hit сохранение не выполняется. Живого прогона CI не делалось; эффект отложенный, стоимость — только минуты CI, отсюда LOW.
- **fix_direction**: либо включить в ключ то, что меняется вместе со скачиваемой сборкой, и добавить `restore-keys` для частичного попадания, либо закрепить версию редактора в `.vscode-test.mjs` и внести её в ключ — тогда комментарий станет правдой; в любом случае привести текст комментария в соответствие с фактическим поведением обеих сторон (кэш и `version`).

---

### claude-14

- **reviewer**: claude
- **severity**: LOW
- **kind**: pattern
- **domain**: architecture
- **title**: Номера строк в новых строках `api-facts.md` не воспроизводятся: правило 4 требует повторяемой команды, а привязка идёт к подвижному `main`
- **mechanism**: правило 4 таблицы требует, чтобы цитата бралась «только из локально скачанного файла источника, командой, которую можно повторить», и чтобы в строке стояла эта команда или номер строки. Для источников, зафиксированных тегом (`vscode.d.ts` 1.85.0), это работает. Для источников с `main` номер строки — не адрес, а слепок дня: проверено сегодня (2026-09-04, таблица заявляет базу «`main` на 2026-09-03») — факт 55 указывает `sample/.github/workflows/ci.yml:24-31`, фактический блок лежит на строках 29-36; факт 47 указывает `viewsExtensionPoint.ts:318-320` для `case 'activitybar'`, фактически 317-319. Текст цитат в обоих случаях совпал дословно. Это тот же механизм, что уже отмечен для факта 39, и он структурный: пока адрес — «файл + строка на `main`», расхождение будет появляться заново после каждого чужого коммита, а ревьюер каждый раз не сможет отличить «источник переехал» от «цитата выдумана».
- **trigger**: воспроизводится в нормальной работе — любая последующая проверка таблицы
- **in_scope**: да
- **anchor**: `docs/plans/projects-tree/api-facts.md`, строки-факты 47 и 55 (плюс уже известный 39)
- **evidence**:
  ```
  # curl -s https://raw.githubusercontent.com/microsoft/vscode-test/main/sample/.github/workflows/ci.yml | grep -n "xvfb-run"
  30:        run: xvfb-run -a npm test
  # факт 55 заявляет: sample/.github/workflows/ci.yml:24-31
  ```
- **verification**: confirmed
- **verification_note**: оба источника скачаны и пронумерованы командами, приведёнными в evidence (`grep -n` по свежему `curl`); совпадение **текста** подтверждено, расходятся только номера. Существенным считаю не сам сдвиг (он объясним движением `main`), а то, что формат адреса делает правило 4 непроверяемым для всех источников с `main` — а таких в таблице большинство новых строк.
- **fix_direction**: для источников без тега фиксировать в адресе неподвижный якорь — хэш коммита в URL либо повторяемую команду поиска (`grep -n "<уникальная подстрока>"`) вместо номера строки; номер строки оставить только там, где источник закреплён тегом.

---

### claude-15

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: reliability
- **title**: Свёрнутость узла-группы записывается в `ExpansionStore`, но восстановиться не может — при переключении `location` группа снова раскрывается
- **mechanism**: `extension.ts` пишет в хранилище раскрытие любого элемента, включая `RootGroupNode` (ключ `root:<rootId>`). Но `toRootGroupTreeItem` намеренно не спрашивает `isExpanded`, потому что дефолт группы и так `Expanded`, а предикат умеет только поднимать дефолт. Хранилище при этом — множество раскрытых ключей: `record(key, false)` **удаляет** ключ, и «свёрнуто пользователем» становится неотличимо от «никогда не трогали». Итог: для узлов-проектов хранилище закрывает межвьюшный разрыв (в этом его смысл), а для узлов-групп — не закрывает в обратную сторону: пользователь, свернувший группу в Activity Bar и переключивший размещение в Explorer, увидит её снова раскрытой. Половина DoD 03-C («переключение размещения не рушит состояние дерева») для групп не выполняется, и запись их состояния сейчас — чистый расход `globalState`.
- **trigger**: воспроизводится в нормальной работе — свернуть группу и переключить `projectsTree.location`; требует настроенных двух корней (иначе групп нет)
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/tree-view/item.ts:73-83` (+ `src/editor/tree-view/expansion.ts:60-66`)
- **evidence**:
  ```ts
  // No `isExpanded` parameter: the default below is already `Expanded` when non-empty, and the
  // store's predicate only ever upgrades a default to `Expanded`, never downgrades one to
  // `Collapsed` … — consulting it here could not change the result.
  const collapsibleState =
    group.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : ...;
  ```
- **verification**: confirmed
- **verification_note**: рассуждение в комментарии верно для текущей формы хранилища — при множестве раскрытых ключей опрос действительно ничего не изменил бы. Дефект не в этой строке, а в форме хранилища: `record(key, false)` (`expansion.ts:66`) удаляет ключ, поэтому «явно свёрнуто» нигде не хранится. Ограничение нигде не названо как незакрытая часть DoD — в комментарии оно подано как «consulting it here could not change the result», что читается как «вопрос закрыт».
- **fix_direction**: либо сделать хранилище трёхзначным (раскрыто / свёрнуто / не трогали) и тогда опрашивать его для обоих видов элементов, либо перестать писать состояние групп вовсе и назвать ограничение явно — в комментарии и в DoD, чтобы «не работает» не выглядело как «не нужно».

---

### claude-16

- **reviewer**: claude
- **severity**: LOW
- **kind**: point
- **domain**: architecture
- **title**: Факт 56 цитирует одно предложение источника и обрывается перед соседним, где то же событие описано словом «visible», а не «expanded»
- **mechanism**: вывод факта 57 (замкнутый круг активации) держится на прочтении факта 56 буквально: событие возникает при **раскрытии** view, а раскрыть view со ложным `when` нельзя. Источник (`activation-events.md`) в разделе `## onView` даёт два предложения: цитируемое на строке 146 («whenever a view of the specified id is **expanded** in the VS Code sidebar») и следующее на 148 («The activation event below will fire whenever a view with the `nodeDependencies` id is **visible**»). Второе в строку 56 не попало, хотя оно из того же раздела и использует другое слово для того же события. На вывод 57 это не влияет (view, скрытый `when`, не является ни раскрытым, ни видимым), но выбор цитаты выглядит как отбор под нужный вывод, а не как полный пересказ раздела — а таблица, по своей же истории, страдала именно от усечённых цитат (ревизия 4 переписала факты 2, 5, 7, 8, 9 ровно по этой причине).
- **trigger**: недостижим как баг — расхождение в оформлении источника, не в поведении
- **in_scope**: да — строка добавлена этим диапазоном
- **anchor**: `docs/plans/projects-tree/api-facts.md`, факт 56
- **evidence**:
  ```
  # curl -s .../activation-events.md | grep -n -A 4 "^## onView"
  146:This activation event is emitted … whenever a view of the specified id is expanded in the VS Code sidebar. Built-in views do not emit an activation event.
  148:The activation event below will fire whenever a view with the `nodeDependencies` id is visible:
  ```
- **verification**: confirmed
- **verification_note**: источник скачан, обе строки воспроизведены командой из evidence; номер строки 146 в факте 56 совпал точно. Проверял именно потому, что на факте 56 висит единственное обоснование новых `activationEvents`; материального расхождения нет, есть неполнота цитаты.
- **fix_direction**: дописать в строку 56 второе предложение раздела и явно сказать, что оба слова описывают одно событие, а вывод 57 верен при любом из двух прочтений — иначе следующий проверяющий будет решать эту же неоднозначность заново.

---

## Coverage

Проверено и признано чистым (без находок), по всему диффу `ad7bb67..HEAD`:

- **Идентичность ключа раскрытия.** Главный вопрос брифа проверен и закрыт: `treeElementKey` (HEAD — `expansion.ts:35`) — единственная реализация ключа, и её результат присваивается в `item.id` в обеих ветках `toTreeItem` (`item.ts:37`, `:74`) и записывается в хранилище в `extension.ts:82,85`. Расхождения «ключ хранилища ≠ `TreeItem.id`» нет. Пространства ключей узлов (`<rootId>:<pathFromRoot>`) и групп (`root:<rootId>`) не пересекаются, потому что `rootId` — валидированный абсолютный путь и строкой `root` быть не может.
- **Бейдж и единица подсчёта.** `isBadgeWithinPlatformLimit` считает code points спредом строки — та же единица, что в `validateHighlight` (`src/projects/classification/validation.ts`); ограничение ≤2 и обе ветки факта 7 (переросший бейдж отбрасывается, но цвет сохраняется; пустая спека не создаётся) реализованы и покрыты тестами по значению.
- **Диффер декораций.** Логика `update` (сравнение спек, сигнал самому URI и всем предкам, отсутствие сигнала при неизменном дереве, пропуск `RootGroupNode` без `resourceUri`) прочитана целиком; на непересекающихся корнях корректна, ancestor-сигналинг реализован ровно так, как требует цитата факта 9. Единственная найденная брешь — ключ по пути (claude-05).
- **Режим `none`.** `locationContextKeys('none')` гасит оба ключа, `manifest-contract.test.ts` проверяет это против манифеста («maps each placement mode to exactly one visible view» + нулевой случай), провайдер зарегистрирован на оба id, `viewsWelcome` и `menus.view/title` продублированы на оба id и это тоже проверено тестом. Забытых мест по фактам 5/46 не нашёл.
- **Три из четырёх новых проверок сравнивают независимые источники.** `check-chain.test.ts` (AGENTS.md против `scripts.check`, с отдельным ассертом против пустого парса), `compat-floor.test.ts` (`engines.vscode` против пина `@types/vscode` и против `pnpm-lock.yaml`; регекс по локу проверен — `grep -n "^  '@types/vscode@" pnpm-lock.yaml` даёт строки 974 и 4174, то есть выборка непустая и тест не проходит вакуумно), `manifest-contract.test.ts` (манифест против экспортов `location.ts`). Ни одна из трёх не сгенерирована из проверяемого. `check-l10n check` тоже переизвлекает ключи из исходников, а не читает свой же `generate`-вывод — эта часть его устройства верна; брешь в нём другая (claude-12).
- **`l10n:check` и `schema:check` заведены в `pnpm check`** и одновременно дописаны в список AGENTS.md — правило «новая проверка попадает и в цепочку, и в канон» соблюдено, и теперь машинно проверяется.
- **`node -e "fs.rmSync(...)"` в `test:integration` работает.** Проверено прогоном: Node действительно даёт `fs` в контексте `-e`; скрытого отказа здесь нет.
- **`xvfb-run -a` без `if: runner.os`** — корректно, джоба закреплена за `ubuntu-latest`; факт 55 условие оправдывает, отсутствие условия при одном OS дефектом не является.
- **Локализация по составу.** Все 16 `%key%`-ссылок манифеста разрешаются в `package.nls.json`, оба nls-файла имеют одинаковый набор ключей, все три рантайм-строки (`Open Project`, `Add as Project Root`, длинная про `invalid`) присутствуют в обоих бандлах, значения ключа `bundle.l10n.json` равны ключам (что и проверяет `check-l10n`). Отсутствие проверки на висячие `%key%` — уже отмечено qwen-04.
- **Факты, сверенные с источником заново, совпали дословно**: 5 (`viewsExtensionPoint.ts:134` и `:184` — обе строки на месте), 47 (`hideIfEmpty: true` на 416, внутри заявленного диапазона), 55, 56, 58. Расхождений текста цитат не нашёл ни в одной; расхождения только в номерах строк (claude-14) и в полноте цитаты 56 (claude-16).
- **Факт 43 и его последствия.** Production-код планку держит: `decoration-provider.ts` не читает `ThemeColor.id` нигде, `DecorationSpec` носит `colorId: string`, `toFileDecoration` — единственное место конструирования. `git grep -n "\.color?\.id\|ThemeColor" HEAD -- packages/projects-tree/src` даёт только конструирование (`item.ts:102`, `decoration-provider.ts:86`) и два тестовых мока. Из двух моков поле `id` **ассертит** только `item.test.ts:158`; `decoration-provider.test.ts` объявляет его в моке, но проверяет лишь `expect(decoration?.color).toBeDefined()` — то есть неверная посылка в production не осталась, открытым остаётся ровно `item.test.ts` (уже известно), а мок декораций стоит почистить заодно.
- **Границы модулей.** `src/projects/**` в диффе `vscode` не импортирует; `location.ts`, `sort.ts`, `top-level.ts`, `expansion.ts` действительно свободны от `vscode` и тестируются без него; `refresh.ts` держит структурный `Refreshable` вместо конкретного типа, чтобы не замкнуть `commands/` и `tree-view/` — цикл проверен, его нет.
- **Механизмы M1-M6 из round 05.** Воспроизведения M1 в новом коде диффа не нашёл: `HighlightDecorationProvider.update` вызывается из `provider.refresh()`, `toTreeItemLabel` — из `item.ts`, `locationContextKeys` — из `context-keys.ts`, `ExpansionStore.isExpanded`/`record` — из `extension.ts`. Единственные новые экспортируемые символы без production-вызова — `ExpansionStore.retainOnly` (уже известно, qwen-03) и `RootGroupRegistry.invalidate` (`registry.ts:84`, файл вне диффа — тот же класс, что qwen-06).

Не проверялось: `pnpm-lock.yaml` (751 строка изменений — сверялось только разрешение `@types/vscode`), `packages/projects-tree/README.md`, `src/projects/**` за пределами `validation.ts` (этап 02, вне диапазона), содержимое `docs/plans/projects-tree/03-tree-view.md` как плана (читался раздел «Решения, изменённые при реализации», но полнота плана не аудировалась).

### Мнение о severity по уже известным находкам (по прямому запросу оркестратора)

- `ExpansionStore.retainOnly` не вызывается из production (qwen-03, MEDIUM) — **согласен с MEDIUM**, но добавлю: тот же дефект есть у `RootGroupRegistry.invalidate` (`registry.ts:84`), а `NodeRegistry.forget`/`invalidate` (qwen-06) — третий случай. Три экземпляра одного механизма в одном компоненте — это уже не три находки, а `pattern`, и как паттерн он тянет на верхнюю границу MEDIUM: приёмочный пункт «у каждого нового экспортируемого символа есть вызов вне тестов» после round 05 не соблюдается систематически, а не разово.
- Висячие `%key%` не проверяются кроме `colors` (qwen-04, MEDIUM) — **согласен с MEDIUM**; сюда же примыкает claude-08 (те же несвязанные литералы, только context key и имена команд), и лечится это одним расширением контрактного теста.
- Guard `main()` в `check-l10n.ts` (qwen-05, MEDIUM) — **завысил бы до MEDIUM только с оговоркой**: на POSIX без пробелов в пути сравнение сходится, и режим отказа — тихий no-op обеих команд `l10n:*`. Тихий no-op проверки страшнее самой проверки, так что MEDIUM оправдан; но `trigger` у него честнее звучит как «рукотворный вход», как qwen и написал.
- Устаревшие комментарии в `ci.yml` и `.vscode-test.mjs` (qwen-07, LOW) — **предлагаю поднять до MEDIUM в части `ci.yml`**: там комментарий не просто устарел, а обосновывает стратегию кэша утверждением, неверным по семантике `actions/cache` (claude-13). Это не стилистика, а неверная посылка в обосновании работающего шага CI.
- `item.test.ts` читает `ThemeColor.id` (LOW/MEDIUM?) — **MEDIUM**. Мок объявляет публичное поле `id`, которого на планке 1.85 у класса нет, и тест на нём ассертит (`expect(icon.color?.id).toBe('projectsTree.highlight')`). Это не стилевая мелочь: тест утверждает форму API, которую сам же придумал, и именно этот класс ошибки уже стоил таблице факта 43. Пока мок богаче планки, он способен сделать зелёным код, который на 1.85 не соберётся, — то есть подрывает то, что `compat-floor.test.ts` защищает машинно.
- Номера строк факта 39 невоспроизводимы (LOW) — **согласен с LOW по последствиям, но см. claude-14**: причина не в факте 39, а в формате адреса для источников с `main`, и фиксить надо формат, иначе находка вернётся в следующем раунде на других строках.

## Refuted

- `claude-r1 | Дубликат `treeElementKey` в `registry.ts` и `expansion.ts`, тест сверяет `item.id` с другой реализацией | Наблюдалось в рабочем дереве, которое правилось по ходу ревью; на HEAD (`git grep treeElementKey HEAD`) функция одна, в `expansion.ts`, и `item.test.ts` импортирует именно её — на ревьюируемом материале дефекта нет`
- `claude-r2 | `check-chain.test.ts` может пройти вакуумно при сломанном парсере AGENTS.md | Второй кейс файла это закрывает: `actualSteps().length > 5` и `documentedSteps()` содержит `format:check` — обе выборки обязаны быть непустыми и осмысленными`
- `claude-r3 | `compat-floor.test.ts` может пройти вакуумно, если регекс по `pnpm-lock.yaml` ничего не находит | Пустая выборка даёт `[] !== ['1.85.0']` и красит тест; фактически регекс находит две строки (974, 4174) — проверено грепом`
- `claude-r4 | Коллизия ключей `<rootId>:<pathFromRoot>` и `root:<rootId>` в `ExpansionStore` | `rootId` — валидированный абсолютный путь (`isValidRootPath`), поэтому префикс `root:` из `nodeKey` недостижим; остаточный случай (путь корня, содержащий `:`) на POSIX требует рукотворного имени, на Windows — недопустимого имени файла`
- `claude-r5 | `%key%` в `viewsWelcome` с `command:`-ссылкой не декодируется и покажет литерал | Факт 37 покрывает разбор query как URI-кодированного JSON, а факт 30 — синтаксис `%key%`; строка в обоих nls-файлах ему соответствует, включая экранирование `%22%40ext%3A…%22``
- `claude-r6 | `node -e "fs.rmSync(...)"` в `test:integration` упадёт на `fs is not defined` | Прогнано: Node предоставляет `fs` в контексте `-e`, команда работает`
