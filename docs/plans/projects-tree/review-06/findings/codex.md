# Находки — reviewer: codex (внешний Codex CLI), round 06

**Статус запуска.** `codex-eval.sh` завершился с кодом `141` (SIGPIPE — вне таблицы штатных кодов
обёртки 0/2/3/4/5/6/7/8/127). `err.log` пуст, предупреждений (`WARNING:`) нет. `out.log` содержит
271 строку и структурно завершён: 13 находок, раздел «Опровергнутые гипотезы», раздел «Coverage» —
без обрыва по месту. Сырой ответ сохранён в `docs/plans/projects-tree/review-06/raw/codex.md`.
Содержимое принято как полный ответ; код `141` зафиксирован как аномалия обёртки (вероятно, читатель
её stdout закрылся после того, как файл уже был записан), а не как потеря данных — это не код `0`,
поэтому фиксирую отдельно, а не молчу.

**Дрейф материала во время работы.** Ревью запускалось по диапазону `ad7bb67..HEAD` (46 файлов,
зафиксированному в `raw/full.diff`), но за время верификации `HEAD` рабочего дерева ушёл вперёд на
коммит `342fb31` («test(integration): run the tree in a real editor, in its own CI job»), и поверх
него появились незакоммиченные правки (`api-facts.md`, `package.json`, `manifest-contract.test.ts`).
Часть находок ниже (codex-01, частично codex-13) была верна для исходно заданного диапазона и уже
закрыта в текущем `HEAD` — это отмечено в `verification_note` каждой находки, а не скрыто.

Каждая находка ниже — самостоятельная верификация фасилитатора по коду (открыт `anchor`, проверено
окружение), а не пересказ ответа `codex`. `severity`/`kind`/`domain`/`trigger`/`fix_direction` —
как сформулировал `codex`; там, где верификация меняет картину, это explicit в `verification_note`.

## HIGH

### codex-01 — RESOLVED в текущем HEAD (см. verification_note)

- **reviewer**: codex
- **severity**: HIGH (как заявил codex; статус на момент верификации — исправлено)
- **kind**: contract
- **domain**: reliability
- **title**: На момент диапазона `ad7bb67..HEAD` первичная активация была потенциальным замкнутым
  кругом: `onView` + `when` на собственный, не выставленный до активации context key
- **mechanism**: `activationEvents` в исходно ревьюируемом диффе содержал только
  `["onView:projectsTree.view", "onView:projectsTree.explorerView"]`. Оба контрибутированных `views`
  имеют `when` на `projectsTree.locationIsActivityBar`/`.locationIsExplorer` — булевы context keys,
  которые выставляет только код внутри `activate()`. До первой активации оба ключа не определены →
  `when` ложен → view скрыт → контейнер в Activity Bar гаснет (факт 47) → `onView` в принципе не
  может возникнуть (факт 56: событие возникает, когда view **раскрыт**, а скрытый view раскрыть
  нельзя).
- **trigger**: воспроизводился в нормальной работе — чистая установка/reload window до любой другой
  формы активации.
- **in_scope**: да (для диапазона `ad7bb67..HEAD`, зафиксированного в `raw/full.diff`)
- **anchor**: `packages/projects-tree/package.json` (`activationEvents`, `contributes.views[].when`); `src/editor/context-keys.ts`; `src/extension.ts`
- **evidence**: см. `docs/plans/projects-tree/api-facts.md`, факты 56-58 (уже добавлены в текущий
  `HEAD` как раз по итогам этого механизма).
- **verification**: confirmed — но находка уже закрыта в текущем состоянии рабочего дерева
- **verification_note**: Подтверждаю мехнизм самостоятельно для диапазона `ad7bb67..HEAD`: в момент
  начала верификации `package.json` содержал ровно два `onView:` события и никакого
  `onStartupFinished`. К моменту завершения верификации рабочее дерево ушло вперёд (коммит
  `342fb31` + незакоммиченные правки): `activationEvents` теперь
  `["onStartupFinished", "onView:projectsTree.view", "onView:projectsTree.explorerView"]`, а
  `api-facts.md` получил факты 56-58, честно фиксирующие, что живая проверка круга была
  неубедительной («тот же результат получился и на манифесте без `when`»), и объясняющие выбор
  `onStartupFinished` расчётом стоимости ошибки, а не вердиктом. Проверено независимым чтением
  текущих `package.json` и `api-facts.md` — оба изменения на месте. Отдельно: собственный WebFetch-
  запрос к `code.visualstudio.com/api/references/activation-events` показал, что начиная с VS Code
  1.74.0 `onCommand` для контрибутированных команд генерируется автоматически без явного
  `activationEvents` — то есть даже без `onStartupFinished` у пользователя теоретически был путь
  активации через Command Palette (`projectsTree.refresh`/`projectsTree.addRoot`, оба видны в
  палитре без `enablement`/`when`). Это не отменяет находку (обнаруживаемость всё равно была
  нулевой — ни иконки, ни уведомления), но ослабляет формулировку «круг» до «крайне плохая
  discoverability, с формально существующим, но ненайденным пользователем выходом» — сейчас, впрочем,
  вопрос закрыт добавлением `onStartupFinished`, и это единственный вывод, который важен для отчёта.
- **fix_direction**: уже реализовано в текущем `HEAD` (`onStartupFinished` + facts 56-58); отдельно
  стоит рассмотреть цитату официальной документации про автогенерацию `onCommand` с 1.74.0 как
  дополнительное подтверждающее api-facts.md наблюдение, если понадобится обосновать надёжность пути
  через Command Palette.

### codex-02

- **reviewer**: codex
- **severity**: HIGH
- **kind**: pattern
- **domain**: architecture
- **title**: Весь пакет 03-B (выделение узлов) недостижим из production object graph
- **mechanism**: `activate()` в `packages/projects-tree/src/extension.ts:32-40` передаёт в
  `ProjectsTreeProvider` только `DEFAULT_RULES`. `DEFAULT_RULES`
  (`src/projects/classification/defaults.ts`) содержит три правила (`repo-marker`,
  `ignored-folders`, `hidden-folders`), ни одно не задаёт `highlight`. Единственный код, способный
  превратить пользовательский rules-файл (с `highlight`) в `Rule[]` — `loadRulesFile`
  (`src/projects/classification/rules-file.ts:129`) — нигде не вызывается вне
  `rules-file.test.ts`/`index.test.ts`/реэкспорта в `index.ts`.
- **trigger**: воспроизводится в нормальной работе — пользователь физически не может получить
  `label`/`icon`/`description`/`color`/`badge`/`sortWeight` выделение, заявленное DoD 03-B, потому
  что источник `Verdict.highlight` в реальном расширении всегда пуст.
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/extension.ts:32-40`; `src/projects/classification/defaults.ts`; `src/projects/classification/rules-file.ts:129`
- **evidence**:
  ```ts
  const provider = new ProjectsTreeProvider(
    () => readRoots().roots,
    readShowRootNodes,
    createNodeFileSystemReader(),
    DEFAULT_RULES,
    ...
  );
  ```
  `grep -rn loadRulesFile` вне `node_modules` находит только определение в `rules-file.ts`, реэкспорт
  в `classification/index.ts` и использования в `*.test.ts` — ни одного вызова из `src/editor/**`
  или `extension.ts`.
- **verification**: confirmed
- **verification_note**: Проверено самостоятельно чтением `extension.ts`, `defaults.ts` и
  `grep -rn loadRulesFile`. Это прямое повторение механизма M1/M5 из `review-05/REPORT.md`
  (реализация и тесты существуют изолированно от production composition root) — тот самый класс
  отказа, который BRIEF просил перепроверить в первую очередь. На момент верификации в `HEAD`
  (`342fb31` + текущие незакоммиченные правки) вызов `loadRulesFile` из `extension.ts` по-прежнему
  отсутствует — находка не закрыта.
- **fix_direction**: Подключить чтение и загрузку канонического rules-файла в editor adapter
  (`activate()`/`refreshFromSettings`) до создания и до каждого `refresh()` провайдера; закрыть
  сквозным тестом «сохранённые правила → реальный `TreeItem`/`FileDecoration`», а не только
  вручную собранным `Verdict` в unit-тестах.

### codex-03

- **reviewer**: codex
- **severity**: HIGH
- **kind**: contract
- **domain**: reliability
- **title**: Раскрытие root-групп не переносится между двумя view при первом появлении
- **mechanism**: `toProjectTreeItem` (`item.ts:30-46`) при первом появлении узла в view учитывает
  `isExpanded(key)` для дефолтного `collapsibleState`. `toRootGroupTreeItem` (`item.ts:78-88`) этого
  не делает вовсе: `collapsibleState` для непустой root-группы всегда `Expanded`, параметр
  `isExpanded` в сигнатуру функции не передаётся. План (`03-tree-view.md`, DoD 03-C) требует
  «разложенное дерево сохраняется при переключении» без оговорки про корневые группы.
- **trigger**: воспроизводится в нормальной работе — свернуть root-группу в одном размещении,
  переключить `projectsTree.location` на другое — группа в новом view откроется развёрнутой.
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/tree-view/item.ts:78-88` (`toRootGroupTreeItem`)
- **evidence**:
  ```ts
  function toRootGroupTreeItem(group: RootGroupNode): vscode.TreeItem {
    const key = treeElementKey(group);
    const collapsibleState =
      group.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
  ```
- **verification**: confirmed
- **verification_note**: Подтверждено самостоятельным чтением `item.ts` и `expansion.ts`. Гипотеза
  codex про «ключ не совпадает с `TreeItem.id`» из BRIEF — проверена и отдельно опровергнута самим
  codex в разделе «Опровергнутые гипотезы» (`item.id = key = treeElementKey(...)`, тот же ключ
  использует `extension.ts` при записи раскрытия) — я это подтверждаю тем же чтением кода, ключи
  совпадают. **Важная поправка к формулировке codex**: часть mechanism про «после материализации
  обоих view последующий expand/collapse в одном view не синхронизирует второе» — это не
  незамеченный баг, а прямо признанный и принятый в `03-tree-view.md` («Решения, изменённые при
  реализации») trade-off: хранилище «не удерживает состояние между обновлениями — это делает
  платформа — а только переносит его между двумя id» при первом появлении узла. Настоящий,
  неприкрытый планом дефект — только asymmetры root-группы (нет параметра `isExpanded` вовсе), для
  project-узлов первый перенос работает корректно.
- **fix_direction**: Передать `isExpanded` в `toRootGroupTreeItem` симметрично `toProjectTreeItem` и
  использовать его для дефолтного `collapsibleState`, чтобы свёрнутая при переключении root-группа
  не открывалась заново в другом размещении при первом появлении.

## MEDIUM

### codex-04

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: tests
- **title**: Интеграционные тесты активации/размещения проходят при удалении защищаемого production
  wiring
- **mechanism**: `activation.test.ts` вызывает `extension.activate()` напрямую и проверяет только
  `extension.isActive === true` плюс что оба id присутствуют в `package.json.contributes.views` —
  не наблюдает ни `createTreeView`, ни decoration-провайдер, ни expansion-подписки. `location.test.ts`
  тоже вызывает `.activate()` напрямую, затем переключает `projectsTree.location` и проверяет только,
  что сама настройка сохранилась и `isActive` не сбросился — не читает фактическое значение context
  key (открыто признано в собственном doc-комментарии файла: «no documented, quoted-in-api-facts.md
  API for an extension to read back a context key's current value»). Мысленное удаление
  `createTreeView`/location-listener/decoration-аргумента/expansion-подписок из `extension.ts` не
  меняет исход ни одной ассерции этих двух тестов.
- **trigger**: будущая регрессия composition root пройдёт мимо CI; текущий зелёный `test:integration`
  создаёт ложную гарантию именно для тех швов, которые round 05 уже ловил (M1/M5).
- **in_scope**: да
- **anchor**: `packages/projects-tree/test/integration/activation.test.ts`; `packages/projects-tree/test/integration/location.test.ts`
- **evidence**:
  ```ts
  await extension.activate();
  assert.equal(extension.isActive, true);
  ```
  (`activation.test.ts`, вся содержательная проверка после сверки id в манифесте)
- **verification**: confirmed
- **verification_note**: Прочитаны оба файла целиком самостоятельно (не только evidence codex).
  `location.test.ts` честно документирует свой собственный blind spot в шапке файла — это снижает
  риск «тест выдаёт себя за более сильную защиту, чем является» (он не маскируется), но не отменяет
  сам факт, что защищаемое поведение (реальная регистрация view/decorations/expansion) тестом не
  наблюдается.
- **fix_direction**: Добавить наблюдение реального эффекта: для activation — что `createTreeView`
  действительно вызван для обоих id (например, через `vscode.window.registerTreeDataProvider`-side
  эффект, наблюдаемый по факту появления данных у `getChildren`, а не только по `isActive`); для
  location — не полагаться на отсутствие API чтения context key, а проверять наблюдаемое следствие
  (видимость view через `vscode.window.visibleTextEditors`-аналог для views, если такой существует,
  либо явно зафиксировать это как принятое ограничение с обоснованием, а не молчаливым тестом).

### codex-05

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: reliability
- **title**: Пустой badge (`""`) проходит всю цепочку валидации и создаёт декорацию без видимого
  содержимого
- **mechanism**: JSON-схема (`schemas/rules.schema.json:238-241`) задаёt `badge` как `maxLength: 2`
  без `minLength`. Core-валидация `validateHighlight`
  (`src/projects/classification/validation.ts:117-131`) считает `badge: ''` decorating-полем
  (`highlight.badge !== undefined` истинно для `''`), поэтому не срабатывает диагностика «пустая
  декорация». Адаптер `buildDecorationSpec`
  (`src/editor/decorations/decoration-provider.ts:71-81`) повторяет ту же логику: `badge === undefined
  && highlight.color === undefined` не ловит `badge === ''`, и функция возвращает
  `{ badge: '', ... }` вместо `undefined`, если `color` не задан.
- **trigger**: сейчас достижимо только на рукотворном входе (см. codex-02 — highlight-правила вообще
  не доходят до production); после подключения rules-файла — обычный валидный по текущей схеме файл
  с `"badge": ""`.
- **in_scope**: да
- **anchor**: `packages/projects-tree/schemas/rules.schema.json:238-241`; `src/projects/classification/validation.ts:117-131`; `src/editor/decorations/decoration-provider.ts:71-81`
- **evidence**:
  ```ts
  const badge =
    highlight.badge !== undefined && isBadgeWithinPlatformLimit(highlight.badge)
      ? highlight.badge
      : undefined;
  if (badge === undefined && highlight.color === undefined) return undefined;
  return { badge, tooltip: highlight.description, colorId: highlight.color };
  ```
- **verification**: confirmed
- **verification_note**: Прослежено вручную по всем трём слоям (schema → core validation → adapter);
  `isBadgeWithinPlatformLimit('')` возвращает `true` (`[...''].length` = 0 ≤ 2), так что ничего в
  цепочке не отбрасывает `''` до `new vscode.FileDecoration('', tooltip, undefined)`.
- **fix_direction**: Добавить `minLength: 1` в schema для `badge`, и/или нормализовать `badge: ''`
  в `undefined` до проверки «decorating field присутствует» — согласованно в core validation и в
  adapter, а не в одном из двух мест.

### codex-06

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: `check-l10n` не проверяет ссылки `%key%` из `package.json` против NLS-бандлов
- **mechanism**: manifest-канал `runCheck` (`tools/check-l10n.ts:264-283`) сравнивает только наборы
  ключей `package.nls.json` и `package.nls.ru.json` между собой — сам `package.json` не читается ни
  разу. Удаление ключа, используемого в манифесте (`%someKey%`), из обоих NLS-файлов одновременно,
  либо опечатка в `%key%` в `package.json`, не даёт никакой ошибки в `pnpm check`.
- **trigger**: обычное переименование/удаление NLS-ключа при правке манифеста.
- **in_scope**: да
- **anchor**: `tools/check-l10n.ts:264-283`
- **evidence**:
  ```ts
  const manifestEn = readJsonRecord(PACKAGE_NLS_EN);
  const manifestRu = readJsonRecord(PACKAGE_NLS_RU);
  const manifestDiff = diffKeySets(Object.keys(manifestEn), Object.keys(manifestRu));
  ```
- **verification**: confirmed
- **verification_note**: Прочитан весь `runCheck`; `package.json` нигде не парсится этим файлом.
  Совпадает с ранее известным (по заданию оркестратора) открытым пунктом ревью qwen — «dangling
  `%key%` manifest references unchecked except for `colors`» (последнее покрыто отдельно
  `manifest-contract.test.ts`, но только для `contributes.colors`, не для остальных `%key%`
  вхождений).
- **fix_direction**: Отдельным проходом извлекать все `%key%` из `package.json` и проверять цепочку
  `package.json → package.nls.json (обязан существовать) → package.nls.ru.json`, включая
  неиспользуемые NLS-ключи в обратную сторону.

### codex-07

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: point
- **domain**: tests
- **title**: AST-экстрактор `check-l10n` молча пропускает алиасированный импорт `l10n`
- **mechanism**: `isLikeL10nNamespace` (`tools/check-l10n.ts:57-66`) распознаёт только identifier с
  буквальным текстом `'l10n'` либо property-access, чьё имя равно `'l10n'` — привязку через
  TypeScript symbol/import не резолвит. `import { l10n as i18n } from 'vscode'; i18n.t(...)` даёт
  `callee.expression` с `text === 'i18n'` — `isLikeL10nNamespace` вернёт `false`, `isL10nTCall` тоже
  `false`, и вызов **не распознаётся вовсе как l10n-вызов**: ни строка не извлекается, ни
  extraction error не создаётся — полностью тихий пропуск, а не громкий отказ.
- **trigger**: обычный рефакторинг импорта/переименование алиаса.
- **in_scope**: да
- **anchor**: `tools/check-l10n.ts:57-76`
- **evidence**:
  ```ts
  function isLikeL10nNamespace(expression: ts.Expression): boolean {
    if (ts.isIdentifier(expression)) {
      return expression.text === 'l10n';
    }
    if (ts.isPropertyAccessExpression(expression)) {
      return expression.name.text === 'l10n';
    }
    return false;
  }
  ```
- **verification**: confirmed
- **verification_note**: Подтверждено чтением функции целиком; резолюции через `ts.TypeChecker`/
  символы импорта в файле нет нигде.
- **fix_direction**: Резолвить биндинг через `ts.Program`/`TypeChecker` (проверять, что символ
  идёт из `vscode`'s `l10n`), либо явно и громко отвергать любой вызов `.t(...)`, чей receiver не
  прошёл по буквальному имени `l10n`/`vscode.l10n`, вместо того чтобы такой вызов был не виден
  экстрактору вообще.

### codex-08

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: deps
- **title**: Живые (`test:integration`) тесты не закреплены на заявленной нижней планке VS Code 1.85
- **mechanism**: `packages/projects-tree/.vscode-test.mjs` не задаёт поле `version` вовсе (только
  `launchArgs`, `mocha`, `files`, `extensionDevelopmentPath`) — `@vscode/test-cli`/
  `@vscode/test-electron` в этом случае используют текущий `stable` (задокументировано в самом
  проекте `@vscode/test-cli`, что также отражено в комментарии `ci.yml`, который при этом говорит о
  «pinned `version` in `.vscode-test.mjs`» — а такого поля в файле нет).
- **trigger**: пользователь на официально поддерживаемом floor VS Code 1.85 столкнётся с runtime-
  поведением host, отличным от того, что реально гоняет CI (текущий stable); конкретное
  расхождение поведения в этом ревью не подтверждено — риск, не воспроизведённый дефект.
- **in_scope**: да
- **anchor**: `packages/projects-tree/.vscode-test.mjs:1-38` (нет `version:`); `.github/workflows/ci.yml:76-84` (комментарий про «pinned version»); `tools/compat-floor.test.ts`
- **evidence**:
  ```js
  export default defineConfig({
    files: 'out/test/**/*.test.js',
    extensionDevelopmentPath: '.',
    launchArgs: ['--user-data-dir', userDataDir],
    mocha: { ui: 'tdd', timeout: 20_000 },
  });
  ```
  — поля `version` нет; `ci.yml`: «…keyed on OS only… a version bump simply adds a new version
  directory under the same cache key… unless the pinned `version` in `.vscode-test.mjs` moves».
- **verification**: confirmed
- **verification_note**: Файл `.vscode-test.mjs` прочитан целиком самостоятельно — поля `version`
  действительно нет, комментарий в `ci.yml` описывает несуществующий pin. `compat-floor.test.ts`
  закрепляет только TypeScript-поверхность API (`@types/vscode@1.85.0`), не runtime-поведение хоста
  live-теста.
- **fix_direction**: Либо задать `version: '1.85.0'` (или матрицу floor + stable) в
  `.vscode-test.mjs`, либо исправить комментарий в `ci.yml`, чтобы не утверждать несуществующий pin.

### codex-09

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: pattern
- **domain**: reliability
- **title**: `HighlightDecorationProvider` схлопывает decoration-состояние перекрывающихся корней по
  абсолютному URI
- **mechanism**: Core различает один и тот же физический путь в разных (перекрывающихся) корнях
  через `rootId + pathFromRoot` (`NodeKey`, `registry.ts`). `HighlightDecorationProvider.collect`
  (`decoration-provider.ts:106-125`) индексирует состояние только по `uri.toString()`
  (`key: uri.toString()`), без `rootId`. Если два узла с одинаковым абсолютным путём, но в разных
  корнях, получают разный `HighlightSpec` (возможно при `inRoot`-условии в правиле), они схлопываются
  в один `Map`-слот в `#state`/`#decorations`; порядок обхода корней определяет, чей `Verdict`
  «выигрывает» для единственного глобального `FileDecoration` этого URI.
- **trigger**: сейчас достижимо только на рукотворном входе — production вообще не производит
  highlight (см. codex-02); после подключения rules-файла — обычная поддерживаемая конфигурация
  перекрывающихся корней с правилом на `inRoot`.
- **in_scope**: да
- **anchor**: `src/editor/decorations/decoration-provider.ts:106-125`; `src/projects/classification/condition.ts` (`inRoot`)
- **evidence**:
  ```ts
  const uri = vscode.Uri.file(element.facts.absolutePath);
  out.push({ key: uri.toString(), uri, spec: buildDecorationSpec(...), ancestorUris });
  ```
- **verification**: confirmed
- **verification_note**: Подтверждено чтением `collect`/`update`; идентичность узла в `NodeRegistry`
  (`registry.ts`) явно включает `rootId`, а decoration-слой — нет. Отсутствие merge/conflict policy
  для этого случая в коде и в плане подтверждено — `00-overview.md` и `03-tree-view.md` не называют
  сценарий перекрывающихся корней применительно к decorations.
- **fix_direction**: Явно определить политику для конфликтующих `Verdict` одного и того же URI
  (детерминированный приоритет по корню, либо запрет на URI-carrier decorations при расходящихся
  вердиктах); закрепить тестом с перекрывающимися корнями.

### codex-10

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: contract
- **domain**: architecture
- **title**: Факт 5 `api-facts.md` делает неверный вывод: платформа НЕ проверяет коллизии view id
- **mechanism**: Факт 5 (`api-facts.md:81-91`) дословно цитирует нормативную формулировку
  vscode.d.ts/contribution docs («should be unique», «recommended») и из неё **выводит** («Тип:
  вывод» не указан явно, но заключение сформулировано как факт): «два view расширения используют
  разные id по соглашению, а не потому что платформа запретит совпадение». Это неверно для
  реального VS Code: `viewsExtensionPoint.ts` (актуальный `main`, метод `addViews`) содержит явную
  проверку и `collector.error` на дубликат id — как локально в пределах одного расширения (через
  `Set` виденных id), так и глобально против `viewsRegistry.getView(item.id)`.
- **trigger**: коллизия view id при загрузке contributions — не текущий сценарий (два id в этом
  диффе различны), поэтому текущая реализация проекта не ломается; дефект — в самом факте, который
  используется как обоснование решения.
- **in_scope**: нет (сама строка факта 5 не входит в диапазон `ad7bb67..HEAD`, но BRIEF явно просит
  проверять `api-facts.md` строки 1,3,5-9,... в этом раунде — фиксирую находку по прямому указанию
  задания)
- **anchor**: `docs/plans/projects-tree/api-facts.md:81-91` (факт 5); `microsoft/vscode`,
  `src/vs/workbench/api/browser/viewsExtensionPoint.ts`, метод `addViews`
- **evidence**: `api-facts.md`: «два view расширения используют разные id по соглашению, а не
  потому что платформа запретит совпадение». Реальный код (проверено самостоятельным запросом к
  исходникам VS Code, не только по цитате codex):
  ```ts
  if (viewIds.has(item.id)) {
    collector.error(localize('duplicateView1', "Cannot register multiple views with same id `{0}`", item.id));
    continue;
  }
  if (this.viewsRegistry.getView(item.id) !== null) {
    collector.error(localize('duplicateView2', "A view with id `{0}` is already registered.", item.id));
    continue;
  }
  ```
- **verification**: confirmed
- **verification_note**: Проверено НЕЗАВИСИМО от `codex` — сделан собственный запрос к исходникам
  `viewsExtensionPoint.ts` и подтверждена именно эта логика (`viewIds.has`/`collector.error` дважды).
  Само решение проекта (два разных id) остаётся правильным и ничем не страдает; неверно только
  обоснование в `api-facts.md`. Это ровно категория, которую BRIEF просит поднимать «отдельно и в
  первую очередь»: строка `api-facts.md`, расходящаяся с источником.
- **fix_direction**: Переписать факт 5: разделить дословную цитату (нормативная формулировка) и
  вывод; добавить отдельную строку с типом «вывод»/«цитата» о том, что платформа **действительно**
  проверяет дубликаты id (с цитатой из `viewsExtensionPoint.ts`), сохранив неизменным продуктовое
  решение «два разных id».

### codex-11

- **reviewer**: codex
- **severity**: MEDIUM
- **kind**: judgement
- **domain**: architecture
- **title**: Безусловный `propagate=true` делает локальное выделение глобальной политикой для
  предков во всех размещениях, включая Explorer
- **mechanism**: `toFileDecoration` (`decoration-provider.ts:85-90`) ставит `decoration.propagate =
  true` для любой построенной декорации без возможности выключить это на уровне правила —
  `HighlightSpec` не несёт поля `propagate`. Эффект: не только ProjectsTree-view, но и весь Explorer
  показывает подъём декорации к предкам для любого выделенного проекта.
- **trigger**: воспроизводится в нормальной работе при наличии хотя бы одного highlight-правила
  (сейчас недостижимо самостоятельно из-за codex-02, но не зависит от кода 03-C/03-D).
- **in_scope**: да
- **anchor**: архитектурный выбор `HighlightDecorationProvider`; `src/editor/decorations/decoration-provider.ts:85-90`; `03-tree-view.md`, раздел «Решения, изменённые при реализации»
- **evidence**:
  ```ts
  function toFileDecoration(spec: DecorationSpec): vscode.FileDecoration {
    ...
    decoration.propagate = true;
    return decoration;
  }
  ```
- **verification**: unverifiable
- **verification_note**: Технический механизм подтверждён по коду. Само решение прямо и честно
  записано в `03-tree-view.md` как «Решения, изменённые при реализации» — «`propagate` включён
  безусловно, а не полем правила» — то есть это не необнаруженное отклонение от плана, а
  сознательный, задокументированный выбор с явно названным «условием пересмотра». Приемлемость
  такого продуктового выбора не проверяется кодом — согласен с самооценкой codex (`unverifiable`),
  правило 1 схемы находки и так не даёт этому классу подняться выше MEDIUM.
- **fix_direction**: Если нужен вариант без propagation для отдельных правил/размещений — вынести
  переключатель на уровень адаптера или `HighlightSpec`, не меняя дефолт; иначе явно зафиксировать
  в онбординге/документации user-facing эффект «выделение всегда поднимается по дереву предков и
  видно в Explorer».

## LOW

### codex-12

- **reviewer**: codex
- **severity**: LOW
- **kind**: pattern
- **domain**: reliability
- **title**: `ExpansionStore.retainOnly`/`NodeRegistry.invalidate`/`RootGroupRegistry.invalidate` не
  вызываются из production
- **mechanism**: Все три lifecycle-метода реализованы и покрыты unit-тестами, но
  `refreshFromSettings`/`activate()` в `extension.ts` их не вызывает ни разу. Удалённые/
  переименованные раскрытые пути остаются в `globalState` до деактивации extension host; удалённые
  roots остаются в registry maps.
- **trigger**: воспроизводится в нормальной работе при многократном изменении roots/структуры
  каталогов на диске; эффект накопительный, не немедленный отказ.
- **in_scope**: да
- **anchor**: `src/editor/tree-view/expansion.ts::retainOnly`; `src/editor/tree-view/registry.ts::NodeRegistry.invalidate,RootGroupRegistry.invalidate`; `src/extension.ts`
- **evidence**: `grep -n "retainOnly\|invalidate" packages/projects-tree/src/extension.ts` не
  находит ни одного совпадения.
- **verification**: confirmed
- **verification_note**: Подтверждено независимым `grep` по `extension.ts` — вызовов нет. Совпадает
  с открытым пунктом ревью qwen («`ExpansionStore.retainOnly` never called from production»);
  согласен с оценкой severity LOW у codex — эффект накопительный и не ломает основной сценарий
  использования сразу (в отличие от codex-02/HIGH, где эффект немедленный и полный).
- **fix_direction**: Определить lifecycle-точку вызова (`onTreeConfigurationChanged`/после смены
  roots) для `invalidate()`/`retainOnly()` над живым набором ключей дерева.

### codex-13

- **reviewer**: codex
- **severity**: LOW
- **kind**: contract
- **domain**: architecture
- **title**: Комментарии опираются на поведение VS Code host, не закреплённое строкой в
  `api-facts.md`
- **mechanism**: Комментарий в `location.ts:34-35` утверждает «Registering a provider for a view
  hidden by its `when` costs nothing: the platform never asks a hidden view for children» — как факт
  о поведении хоста, без цитаты. `.vscode-test.mjs:9-19` обосновывает выбор `/tmp` вместо
  `os.tmpdir()` конкретным лимитом Unix-сокета в 103 символа — тоже поведение хоста/OS, не
  API-поверхность из `vscode.d.ts`.
- **trigger**: недостижим как самостоятельный runtime-баг сейчас; риск — будущее изменение
  поведения хоста/OS без сигнала со стороны типов.
- **in_scope**: да
- **anchor**: `packages/projects-tree/src/editor/tree-view/location.ts:34-35`; `packages/projects-tree/.vscode-test.mjs:9-19`
- **evidence**: цитаты выше; поиск по `api-facts.md` не находит строки, посвящённой именно
  «hidden view → `getChildren` не вызывается».
- **verification**: confirmed
- **verification_note**: Проверено чтением обоих файлов и `grep` по `api-facts.md` на предмет
  соответствующего факта — не найден. Малозначимо для корректности сейчас (оба комментария
  описывают вспомогательные, не защищающие корректность утверждения), поэтому LOW корректен.
- **fix_direction**: Либо добавить цитируемую строку в `api-facts.md` для использованных посылок,
  либо переформулировать комментарии как эмпирические наблюдения без API-гарантии.

## Дополнительно — по прямому запросу оркестратора (не самостоятельные находки codex)

Ниже не входит в 13 находок `codex`, а прямой ответ на вопросы из сообщения оркестратора, заданные
после получения ответа `codex`, для экономии времени на пересчёт.

- **`test:integration` без `dist/`** — уже исправлено. `packages/projects-tree/package.json:203`,
  `"test:integration"` содержит `... && pnpm run build && tsc -p test/tsconfig.json && vscode-test` —
  `pnpm run build` присутствует в цепочке. Проверено независимым чтением `package.json`.
- **Активация через `onStartupFinished`** — см. `verification_note` codex-01 выше: подтверждено
  независимо, находка закрыта в текущем `HEAD`.
- **Тест, проходящий при удалённом защищаемом поведении, помимо названных codex.** Отдельно от
  codex-04 (интеграционные тесты обходят wiring) не нашёл новых кандидатов сверх уже перечисленных
  codex и qwen в отведённое время; `check-chain.test.ts`/`compat-floor.test.ts` сам codex
  проверил и отклонил как независимые (см. «Опровергнутые гипотезы» в `raw/codex.md`) — не
  переопровергал эти два самостоятельно за нехваткой времени, оставляю как unverified с моей
  стороны (см. coverage).

## Coverage

- **Швы между пакетами / production reachability.** Проверено самостоятельно: `extension.ts` целиком
  прочитан; `loadRulesFile`, `retainOnly`, `NodeRegistry.invalidate`, `RootGroupRegistry.invalidate`
  проверены `grep`-ом на отсутствие вызовов из production — подтверждает codex-02 и codex-12.
- **`ExpansionStore`/`collapsibleState`.** Прочитаны `expansion.ts` и `item.ts` целиком; ключ
  (`treeElementKey`) совпадает с `TreeItem.id` в обоих местах записи/чтения (гипотеза из BRIEF про
  расхождение ключа — опровергнута, чисто). Асимметрия root-группы (codex-03) подтверждена, дефект
  реален только в этой части.
- **Декорации.** `decoration-provider.ts` и `validation.ts` прочитаны целиком; пустой badge
  (codex-05) и коллизия по URI для перекрывающихся корней (codex-09) подтверждены построчным
  прослеживанием данных через schema → core → adapter. Единица подсчёта длины badge (code points)
  совпадает между core и adapter — чисто, отдельной находки нет.
- **Два view.** `package.json` (`activationEvents`, `views`, `viewsWelcome`, `menus`) и
  `extension.ts` (`ALL_VIEW_IDS.flatMap`) прочитаны и сверены — регистрация на оба id корректна,
  `none` гасит оба через `locationContextKeys`. Единственная находка — codex-01 (уже закрыта).
- **Тесты, проверяющие себя.** Проверил `check-l10n.ts` целиком (codex-06, codex-07 подтверждены
  самостоятельно, не только по evidence codex). `check-chain.test.ts` и `compat-floor.test.ts` не
  переверял независимо — доверяю самопроверке codex в «Опровергнутые гипотезы» частично, отмечаю как
  непроверенное фасилитатором.
- **Локализация.** `check-l10n.ts` прочитан целиком; manifest-канал (codex-06) и алиасированный
  импорт (codex-07) подтверждены построчно.
- **api-facts.md, приоритетные строки.** Факт 5 проверен самостоятельным запросом к реальному
  исходнику `viewsExtensionPoint.ts` (не только по утверждению codex) — расхождение подтверждено
  (codex-10). Факт 43 (`ThemeColor.id`) проверен по `decoration-provider.ts`'s doc-комментарию —
  production не читает `.id` обратно, исправление полное, отдельной находки нет. Факты 56-58
  (новые, появившиеся в `HEAD` после начала ревью) прочитаны целиком — честно фиксируют
  неубедительность живой проверки; отдельной находки не создаю, это не нарушение канона.
- **CI и тулинг.** `ci.yml` (integration-test job) и `.vscode-test.mjs` прочитаны целиком; codex-08
  (отсутствие `version` при комментарии про «pinned») подтверждён самостоятельно.
- **`pnpm check`/`test:integration` статус.** Не перезапускал по указанию BRIEF; проверил только
  наличие `pnpm run build` в цепочке `test:integration`.

## Отклонённые находки

Явно отклонённых мной (в статусе `refuted`) находок codex среди 13 нет — по каждой либо `confirmed`,
либо `unverifiable` (codex-11, согласно правилу 2 схемы). Собственная переоценка severity/framing (не
отклонение) сделана для codex-01 (framing «круг» смягчён до «нулевая discoverability + формальный
выход через Command Palette», при этом находка как таковая подтверждена и закрыта) и для codex-03
(часть mechanism про межвидовую синхронизацию признана задокументированным design trade-off, а не
незамеченным дефектом — сохранена как `confirmed` из-за независимо подтверждённой асимметрии
root-группы).
