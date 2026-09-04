# Сырой ответ codex-eval.sh (round 06)

Обёртка завершилась с кодом `141` (SIGPIPE, вне таблицы штатных кодов обёртки — не 0/2/3/4/5/6/7/8/127).
err.log пуст, WARNING нет. out.log содержит 271 строку и структурно завершён (13 находок +
секции «Опровергнутые гипотезы» и «Coverage»), поэтому содержимое принято как полный ответ,
а не как усечённый вывод; код 141 зафиксирован как аномалия обёртки, а не как признак потери
данных.

---

Критических находок нет. Подтверждены три HIGH-дефекта: цикл первичной активации, недостижимость всего 03-B из production object graph и неполноценный перенос раскрытия между двумя view.

Отдельно обнаружена одна неверная строка `api-facts.md`: факт 5 расходится с реализацией VS Code 1.85.

## HIGH

### codex-01

- **id:** codex-01
- **reviewer:** codex
- **severity:** HIGH
- **kind:** contract
- **domain:** reliability
- **title:** Цикл активации скрывает оба view при первом запуске
- **mechanism:** Оба view имеют `when` по context keys, которые до активации отсутствуют и считаются ложными. Единственные явные activation events — `onView` этих же скрытых view. Context keys выставляются только внутри `activate()`. Получается цикл: для активации нужно открыть view, а для появления view расширение уже должно быть активировано. Официально `onView` срабатывает при раскрытии/открытии view, а не заранее; соответствующего факта в `api-facts.md` нет. [Activation Events](https://code.visualstudio.com/api/references/activation-events)
- **trigger:** воспроизводится в нормальной работе — чистая установка или reload window до активации расширения каким-либо побочным способом, например командой.
- **in_scope:** да
- **anchor:** контракт первичной активации; `packages/projects-tree/package.json:32-35,64-77`; `packages/projects-tree/src/extension.ts:53-58,95`; `packages/projects-tree/test/integration/activation.test.ts:27-34`; `packages/projects-tree/test/integration/location.test.ts:27-33`
- **evidence:** Manifest допускает активацию только через два view, видимость которых зависит от ключей, устанавливаемых уже внутри `activate()`. Оба живых теста разрывают цикл прямым `extension.activate()`.
- **verification:** confirmed
- **verification_note:** Production-цепочка `activationEvents → when → setContext` проверена целиком. Документация VS Code подтверждает условие срабатывания `onView`.
- **fix_direction:** Добавить независимый путь первичной активации либо вычислять видимость через контекст, существующий до активации. Закрепить API-посылку цитатой в `api-facts.md` и добавить интеграционный сценарий без прямого вызова `activate()`.

### codex-02

- **id:** codex-02
- **reviewer:** codex
- **severity:** HIGH
- **kind:** pattern
- **domain:** architecture
- **title:** Весь пакет 03-B недостижим из production object graph
- **mechanism:** Composition root всегда передаёт `DEFAULT_RULES`, где нет ни одного `highlight`. Единственный преобразователь пользовательского rules file — `loadRulesFile` — production-кодом не вызывается. Поэтому `Verdict.highlight.value` в реальном расширении всегда пуст, и новые label/icon/description/color/badge/sortWeight carriers не срабатывают. Тесты создают highlight вручную и обходят отсутствующий шов.
- **trigger:** воспроизводится в нормальной работе — пользователь вообще не может получить выделение, заявленное DoD 03-B.
- **in_scope:** да
- **anchor:** `packages/projects-tree/src/extension.ts::activate`; `src/projects/classification/defaults.ts::DEFAULT_RULES`; `src/projects/classification/rules-file.ts::loadRulesFile`; `src/editor/tree-view/item.test.ts`; `src/editor/decorations/decoration-provider.test.ts`
- **evidence:** `extension.ts:32-40` передаёт только `DEFAULT_RULES`; defaults содержат лишь `skip`, `project`, `stopDescend`; поиск `loadRulesFile` вне тестов находит определение/реэкспорт, но не вызов. Тесты используют вручную собранный `highlight`.
- **verification:** confirmed
- **verification_note:** Это прямое воспроизведение механизмов M1 и M5 из review-05: реализация и тесты существуют, но production composition root их не соединяет.
- **fix_direction:** Подключить чтение и загрузку канонического rules file в editor adapter до создания/refresh провайдера. Проверять 03-B сквозным тестом от сохранённых правил до реального TreeItem/decoration.

### codex-03

- **id:** codex-03
- **reviewer:** codex
- **severity:** HIGH
- **kind:** contract
- **domain:** reliability
- **title:** ExpansionStore переносит состояние только при первом появлении узла во втором view
- **mechanism:** Два зарегистрированных view существуют одновременно и имеют независимое platform state. Store влияет только на начальный `collapsibleState`; по факту 41 он не переопределяет состояние уже известного узла. После материализации обоих view последующий expand/collapse в одном view не синхронизирует второе. Collapse root group не переносится даже при первом переключении: root всегда получает `Expanded`, а store хранит только множество раскрытых ключей и не отличает явное сворачивание от отсутствия записи.
- **trigger:** воспроизводится в нормальной работе — открыть оба размещения, изменить раскрытие и переключиться обратно; отдельно — свернуть непустую root group и впервые перейти во второе размещение.
- **in_scope:** да
- **anchor:** контракт 03-C «разложенное дерево сохраняется при переключении»; `src/extension.ts:74-87`; `editor/tree-view/expansion.ts:56-67`; `editor/tree-view/item.ts:37-43,73-83`; `api-facts.md`, факт 41
- **evidence:** Project nodes получают только default `Expanded/Collapsed` из store; root groups всегда default `Expanded`; оба view создаются один раз и остаются материализованными.
- **verification:** confirmed
- **verification_note:** Гипотеза о несовпадении ключей опровергнута: `treeElementKey` действительно совпадает с `TreeItem.id`. Дефект находится в семантике platform state и неполной модели store.
- **fix_direction:** Определить двунаправленный контракт переноса, включая explicit collapsed state, и применять его механизмом, способным воздействовать на уже материализованный view. Добавить живой тест повторного цикла `activityBar → explorer → activityBar` и root groups.

## MEDIUM

### codex-04

- **id:** codex-04
- **reviewer:** codex
- **severity:** MEDIUM
- **kind:** pattern
- **domain:** tests
- **title:** Интеграционные тесты проходят после удаления production wiring
- **mechanism:** Activation test отдельно читает manifest, затем только вызывает `extension.activate()` и проверяет `isActive`. Location test записывает setting и читает ту же setting обратно — это делает сама платформа независимо от listener и `setContext`. Остальные тесты вручную создают `ProjectsTreeProvider`. Удаление `createTreeView`, location listener, decoration argument или expansion subscriptions не ломает проверяемые assertions.
- **trigger:** будущая регрессия composition root; текущая зелёная CI создаёт ложную гарантию.
- **in_scope:** да
- **anchor:** `test/integration/activation.test.ts`; `test/integration/location.test.ts`; `test/integration/discovery.test.ts`; `src/extension.ts:61-95`
- **evidence:** Activation assertion наблюдает только успешное завершение прямого `activate()`. Location assertion наблюдает только сохранённое configuration value и живой extension host. Provider-тесты обходят `extension.ts`.
- **verification:** confirmed
- **verification_note:** При мысленном удалении защищаемых production-блоков перечисленные тесты остаются зелёными. Это тот же класс M5, что в review-05.
- **fix_direction:** Добавить black-box тест естественной активации и независимое наблюдение обоих contributed view. Отдельно проверить production-передачу decorations и expansion handlers, не конструируя provider вручную.

### codex-05

- **id:** codex-05
- **reviewer:** codex
- **severity:** MEDIUM
- **kind:** contract
- **domain:** reliability
- **title:** Пустой badge проходит валидацию и создаёт запрещённую пустую FileDecoration
- **mechanism:** Schema задаёт только `maxLength`. Core считает любое defined значение badge декорирующим полем. Адаптер принимает `''`, затем создаёт `new FileDecoration('', undefined, undefined)`. По факту 7 такая декорация не содержит ни badge, ни color, ни tooltip и отбрасывается платформой.
- **trigger:** только на рукотворном входе сейчас из-за codex-02; после подключения rules file — обычный валидный по текущей schema файл с `"badge": ""`.
- **in_scope:** да
- **anchor:** контракт `HighlightSpec.badge`; `schemas/rules.schema.json:115-125`; `projects/classification/validation.ts:107-135`; `editor/decorations/decoration-provider.ts:71-89`; `api-facts.md`, факт 7
- **evidence:** Schema допускает нулевую длину; `isBadgeWithinPlatformLimit('')` возвращает true; `badge !== undefined` проходит guard пустой декорации.
- **verification:** confirmed
- **verification_note:** Значение последовательно проходит schema, core validation и adapter.
- **fix_direction:** Согласовать schema, core и adapter на непустом badge либо нормализовать пустую строку в отсутствие значения до проверки пустой декорации.

### codex-06

- **id:** codex-06
- **reviewer:** codex
- **severity:** MEDIUM
- **kind:** point
- **domain:** tests
- **title:** l10n-check не связывает manifest-ссылки `%key%` с package.nls
- **mechanism:** Manifest-канал сравнивает только наборы ключей английского и русского NLS. Сам `package.json` не читается. Удаление используемого ключа сразу из обоих bundles или опечатка `%key%` в manifest оставляют проверку зелёной.
- **trigger:** обычное переименование или удаление manifest localization key.
- **in_scope:** да
- **anchor:** `tools/check-l10n.ts:267-283`
- **evidence:**
  ```ts
  const manifestEn = readJsonRecord(PACKAGE_NLS_EN);
  const manifestRu = readJsonRecord(PACKAGE_NLS_RU);
  const manifestDiff = diffKeySets(Object.keys(manifestEn), Object.keys(manifestRu));
  ```
- **verification:** confirmed
- **verification_note:** `manifest-contract.test.ts` отдельно защищает только descriptions contributed colors, а не полный набор `%...%` consumers.
- **fix_direction:** Извлекать все `%key%` из manifest, проверять `package.json → base NLS → Russian NLS` и отдельно выявлять неиспользуемые NLS-ключи.

### codex-07

- **id:** codex-07
- **reviewer:** codex
- **severity:** MEDIUM
- **kind:** point
- **domain:** tests
- **title:** AST-экстрактор молча пропускает алиасированный l10n
- **mechanism:** Детектор распознаёт только identifier с буквальным именем `l10n` либо property access, оканчивающийся на `.l10n`. Валидные формы `import { l10n as i18n } from 'vscode'; i18n.t(...)` и локальная привязка `const i18n = vscode.l10n` не дают ни ключа, ни extraction error. Динамический аргумент отвергается громко только после распознавания самого вызова.
- **trigger:** обычный рефакторинг import/binding.
- **in_scope:** да
- **anchor:** `tools/check-l10n.ts:57-76`
- **evidence:**
  ```ts
  if (ts.isIdentifier(expression)) {
    return expression.text === 'l10n';
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'l10n';
  }
  ```
- **verification:** confirmed
- **verification_note:** Symbol/import identity не разрешается; тесты не покрывают алиасированный named import или промежуточную переменную.
- **fix_direction:** Разрешать bindings через TypeScript program/type checker либо машинно запретить неподдерживаемые формы с громкой ошибкой вместо молчаливого пропуска.

### codex-08

- **id:** codex-08
- **reviewer:** codex
- **severity:** MEDIUM
- **kind:** contract
- **domain:** deps
- **title:** Живые тесты не проверяют заявленную нижнюю планку VS Code 1.85
- **mechanism:** `.vscode-test.mjs` не задаёт `version`. Официальный конфиг `@vscode/test-cli` в этом случае использует latest stable. `compat-floor.test` закрепляет только TypeScript API surface; runtime-поведение host, включая факты 41 и 47, проверяется на текущем stable. CI-комментарий при этом говорит о якобы pinned version. [Официальный конфиг `@vscode/test-cli`](https://github.com/microsoft/vscode-test-cli/blob/main/src/config.cts)
- **trigger:** пользователь на поддерживаемом VS Code 1.85 при несовместимости host behavior; конкретная несовместимость в этом ревью не подтверждена.
- **in_scope:** да
- **anchor:** контракт `engines.vscode: ^1.85.0`; `packages/projects-tree/.vscode-test.mjs:21-38`; `.github/workflows/ci.yml:77-83`; `tools/compat-floor.test.ts`
- **evidence:** В test config отсутствует `version`, но CI-комментарий утверждает, что кэш изменяется при переносе pinned `version` в этом файле.
- **verification:** confirmed
- **verification_note:** Документация test-cli дословно задаёт default `stable`. Это поведение также не закреплено отдельной строкой `api-facts.md`.
- **fix_direction:** Запускать live-тесты как минимум на floor 1.85; оптимально — матрицу floor плюс current stable. Добавить цитируемый факт о выборе версии runner.

### codex-09

- **id:** codex-09
- **reviewer:** codex
- **severity:** MEDIUM
- **kind:** pattern
- **domain:** reliability
- **title:** DecorationProvider теряет root-specific verdict для перекрывающихся корней
- **mechanism:** Core различает один абсолютный путь в разных корнях через `rootId + pathFromRoot`, а правила могут зависеть от `inRoot`. DecorationProvider индексирует состояние только по абсолютному URI. Два узла одного пути с разными highlight схлопываются в `Map`; последний полностью заменяет первый. Глобальный FileDecorationProvider затем возвращает одну декорацию для обоих TreeItem.
- **trigger:** только на рукотворном входе сейчас из-за codex-02; после подключения rules file — нормальная поддерживаемая конфигурация вложенных корней с разными `inRoot` highlights.
- **in_scope:** да
- **anchor:** контракт overlapping roots; `00-overview.md`; `projects/classification/condition.ts::inRoot`; `editor/decorations/decoration-provider.ts:106-123,148-170`
- **evidence:** Identity дерева включает root, но decoration key равен `uri.toString()`, а оба состояния строятся через `new Map(...[entry.key, entry])`.
- **verification:** confirmed
- **verification_note:** Для одного URI отсутствует merge/conflict policy; последний обход корней определяет результат.
- **fix_direction:** Явно определить семантику конфликтов root-specific decorations: детерминированный приоритет/merge либо отказ от URI-carrier для расходящихся verdict. Закрепить overlapping-roots тестом.

### codex-10

- **id:** codex-10
- **reviewer:** codex
- **severity:** MEDIUM
- **kind:** contract
- **domain:** architecture
- **title:** Факт 5 неверно утверждает, что коллизии view id не проверяются платформой
- **mechanism:** Строка 5 выводит из schema-description, что уникальность — только рекомендация и платформа не запрещает совпадение. Однако VS Code 1.85 при обработке contributions проверяет дубликаты как внутри расширения, так и в общем registry и выдаёт error. Следовательно, приведённая цитата сама по себе корректна, но сформулированный под ней API-факт ложен. [VS Code 1.85, проверка duplicate view id](https://github.com/microsoft/vscode/blob/1.85.0/src/vs/workbench/api/browser/viewsExtensionPoint.ts#L469-L478)
- **trigger:** коллизия view id при загрузке contributions; текущие два id различны, поэтому текущая реализация не ломается.
- **in_scope:** нет — строка предшествует диапазону, но её проверка явно включена в scope round 06.
- **anchor:** контракт `docs/plans/projects-tree/api-facts.md`, факт 5; `viewsExtensionPoint.ts` VS Code 1.85
- **evidence:** `api-facts.md` утверждает «рекомендация уникальности, а не проверяемое платформой ограничение»; код 1.85 вызывает `collector.error` для duplicate id.
- **verification:** confirmed
- **verification_note:** Ошибка подтверждена по исходному коду именно заявленной нижней версии 1.85. Решение использовать разные id остаётся правильным; неверно только его обоснование.
- **fix_direction:** Исправить факт 5 и добавить дословные цитаты веток duplicate validation из 1.85. Сохранить требование разных id, но обосновывать его реальной проверкой платформы.

### codex-11

- **id:** codex-11
- **reviewer:** codex
- **severity:** MEDIUM
- **kind:** judgement
- **domain:** architecture
- **title:** Безусловный `propagate=true` превращает локальное выделение в глобальную политику предков
- **mechanism:** Любая rule decoration распространяется к предкам и видна не только в ProjectsTree, но и в Explorer. Это сознательно записанное изменение решения, а не нарушение плана, однако выбор сделан на уровне адаптера без возможности выразить иной продуктовый сценарий. Для перекрывающихся корней и насыщенного Explorer это может создавать неочевидное или конфликтующее выделение.
- **trigger:** воспроизводится в нормальной работе при наличии highlight-bearing rules после подключения их production-источника.
- **in_scope:** да
- **anchor:** архитектурный выбор `HighlightDecorationProvider`; `editor/decorations/decoration-provider.ts:85-89`; `03-tree-view.md`, «Решения, изменённые при реализации»
- **evidence:** `propagate` всегда получает `true`; FileDecorationProvider глобален; отключить propagation для отдельного правила или размещения невозможно.
- **verification:** unverifiable
- **verification_note:** Технический эффект подтверждён, но его приемлемость — продуктово-архитектурное решение. Прямого нарушения утверждённого плана нет.
- **fix_direction:** Явно утвердить и документировать область действия propagation. Если нужны разные сценарии, определить политику на уровне адаптера/настройки, не протаскивая платформенную семантику в core без продуктовой необходимости.

## LOW

### codex-12

- **id:** codex-12
- **reviewer:** codex
- **severity:** LOW
- **kind:** pattern
- **domain:** reliability
- **title:** Реализованные lifecycle-cleanup методы не вызываются в production
- **mechanism:** `ExpansionStore.retainOnly`, `NodeRegistry.invalidate` и `RootGroupRegistry.invalidate` существуют и частично покрыты тестами, но composition root их не вызывает. Удалённые/переименованные expanded paths остаются в `globalState`, а удалённые roots — в registry maps до деактивации extension host.
- **trigger:** воспроизводится в нормальной работе при многократном удалении, переименовании или изменении roots; эффект преимущественно накопительный.
- **in_scope:** да
- **anchor:** `editor/tree-view/expansion.ts::retainOnly`; `editor/tree-view/registry.ts::NodeRegistry.invalidate,RootGroupRegistry.invalidate`; `src/extension.ts::refreshFromSettings`
- **evidence:** Поиск usages находит `retainOnly` только в unit tests, `NodeRegistry.invalidate` только в unit test, а `RootGroupRegistry.invalidate` не вызывается вовсе.
- **verification:** confirmed
- **verification_note:** Это ещё одно проявление M1/M5, но без немедленного пользовательского отказа, поэтому severity LOW.
- **fix_direction:** Определить lifecycle-точки для invalidation при изменении roots/rules и pruning после успешной полной materialization дерева либо убрать преждевременно опубликованные методы до этапа, где living set можно вычислить корректно.

### codex-13

- **id:** codex-13
- **reviewer:** codex
- **severity:** LOW
- **kind:** contract
- **domain:** architecture
- **title:** В коде остались API-посылки без валидных строк api-facts.md
- **mechanism:** Помимо bootstrap и test-cli version, комментарий `location.ts` опирается на утверждение, что платформа никогда не вызывает `getChildren` у скрытого view. `.vscode-test.mjs` также обосновывает конфигурацию конкретным размещением Unix socket и лимитом пути. Эти утверждения отсутствуют как строки с дословными цитатами. Первое является поведением VS Code host; второе — зависимым от реализации editor/OS основанием tooling-решения.
- **trigger:** недостижим как самостоятельный runtime-баг; риск проявится при изменении host/test-runner реализации.
- **in_scope:** да
- **anchor:** канон `AGENTS.md — api-facts.md`; `editor/tree-view/location.ts:37-38`; `.vscode-test.mjs:9-27`
- **evidence:** Комментарии формулируют поведение платформы как установленный факт, но факты 39–55 не содержат соответствующих дословных цитат.
- **verification:** confirmed
- **verification_note:** Текущая correctness в основном не зависит от комментария hidden view; поэтому это нарушение канона, а не подтверждённый пользовательский дефект.
- **fix_direction:** Добавить проверяемые цитируемые строки для реально используемых посылок либо переформулировать их как эмпирическое ограничение с воспроизводимым evidence, не как API-гарантию.

## Опровергнутые гипотезы

- `ExpansionStore` пишет не тот ключ, что `TreeItem.id` | опровергнуто: handlers и item используют один `treeElementKey`.
- Исправление `ThemeColor.id` осталось неполным | опровергнуто: production только создаёт `ThemeColor`; `.id` читается лишь у test fake.
- Badge считается в UTF-16 units | опровергнуто: core и adapter используют code points через spread.
- При `propagate` не сигналятся предки | опровергнуто: `collect` сохраняет ancestor URIs, а `update` включает их в change event.
- Режим `none` скрывает только один view | опровергнуто: оба location keys выставляются в false.
- Для второго view забыты welcome/menu/activation/registration | опровергнуто: manifest дублирует оба id, production проходит по `ALL_VIEW_IDS`.
- `check-chain.test.ts` проверяет источник самим собой | опровергнуто: сравниваются `AGENTS.md` и root `package.json`, присутствуют non-vacuity assertions.
- `compat-floor.test.ts` проверяет источник самим собой | опровергнуто: сравниваются manifest engine, dependency и lock resolution; дефект находится в версии live host.
- `propagate=true` напрямую нарушает план | опровергнуто: это явно записанное implementation decision.
- Исправленный факт 43 всё ещё требует `ThemeColor.id` на VS Code 1.85 | опровергнуто: production-read этого свойства отсутствует.

## Coverage

- **Швы и production reachability:** проверены новые exports, composition root, provider constructor, registries, expansion, decorations, configuration и commands. Найдены недостижимые rules→highlight, cleanup methods и тесты, обходящие wiring.
- **ExpansionStore:** проверены storage key, `treeElementKey`/`TreeItem.id`, first-appearance semantics, project nodes, root groups и повторное переключение двух материализованных view.
- **Декорации:** проверены пустота, лимит badge, code-point counting, ThemeColor floor, URI identity, propagation и change events. Исправление факта 43 в production полное.
- **Два view:** проверены ids, `views`, `viewsWelcome`, menus, activationEvents, `none`, context keys и регистрация через `ALL_VIEW_IDS`. Дублирование полное; найден bootstrap-цикл.
- **Тесты, проверяющие себя:** разобраны `check-l10n`, `check-chain`, `compat-floor`, `manifest-contract` и integration suite. `check-chain` и compile-floor assertions независимы; l10n и integration имеют описанные blind spots.
- **Локализация:** проверены runtime и manifest channels, literal/object forms, dynamic arguments, aliases, base/Russian bundles и текущие manifest references. Текущие EN/RU-наборы совпадают; проблема в полноте checker.
- **CI и tooling:** проверены отдельная integration job, `xvfb-run -a`, editor cache, `@vscode/test-electron`/knip и ESLint ignore. Wiring корректен; live host не pinned к floor.
- **API facts:** проверены приоритетные строки 1, 3, 5–9, 27, 28, 32, 39–55. Найдено расхождение факта 5; исправление 43 полное; выявлены незадокументированные посылки.
- **Review-05 M1–M6:** повторились M1/M5. Новых проявлений M2, M3, M4 и M6 не найдено.
- **Архитектурные границы:** импортов `vscode` из `src/projects/**`, ослабления dependency-cruiser или выпадения нового check из `pnpm check` не найдено.
- **Остальной diff:** проверены sorting, top-level grouping, manifest contributions, schemas, lockfile, README/плановые решения и CI. Других подтверждённых дефектов не найдено.
- `pnpm check` и integration suite повторно не запускались согласно условию; ревью выполнено read-only.
