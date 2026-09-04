/**
 * "Hide" and "Manage Hidden…" (`docs/plans/projects-tree/04-actions.md`, package 04-E). Both change
 * the canonical rules file through `editor/rules/store.ts` and both rely on the same caller-supplied
 * `refresh` to make the change visible without a Reload — writing the file does not itself notify
 * `ProjectsTreeProvider`; `extension.ts`'s `refreshFromSettings` re-reads the file, diffs it against
 * the rules currently in effect, and invalidates the identity registries and the quick-open cache
 * exactly when the rules actually changed (the same path a hand-edit of the file takes on the next
 * manual refresh).
 */
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
  createClassifier,
  DEFAULT_RULES,
  type Condition,
  type DirEntry,
  type Rule,
} from '../../projects/classification/index.js';
import type { ClassifiedNode, FileSystemReader } from '../../projects/discovery/index.js';
import { readRulesFileForEdit, writeRulesFile, type RulesFileLocation } from '../rules/index.js';
import { resolveNode, type NodeSelection } from './node-selection.js';

export const HIDE_COMMAND = 'projectsTree.hide';
export const MANAGE_HIDDEN_COMMAND = 'projectsTree.manageHidden';

/**
 * Marks a rule as one "Hide" created, so "Manage Hidden…" can offer exactly those and nothing the
 * user wrote by hand. A prefix on `id`, not a separate boolean field on the schema or a marker in
 * `title`: `title` is the one part of a hide rule a person is expected to read and rename when
 * editing the file by hand (docs/plans/projects-tree/00-overview.md, "Хранение правил" — the file is
 * human-editable), so a marker living there would be the first thing lost to a rename; `id` values
 * are already opaque, generated identifiers everywhere else in this codebase (`randomUUID()` below),
 * so a human is far less likely to touch one at all, and never expected to preserve its exact text
 * on purpose the way a title's wording matters. The alternative — an extra JSON field such as
 * `origin: "hide"` — was rejected because it would need a `rules.schema.json` change for a fact only
 * this package's own commands need to know; nothing else reads or validates it.
 */
const HIDDEN_RULE_ID_PREFIX = 'projectsTree.hidden:';

function isHiddenRule(rule: Rule): boolean {
  return rule.id.startsWith(HIDDEN_RULE_ID_PREFIX);
}

/**
 * `title` is deliberately left unset (R07-L10N-BYPASS): a hardcoded English `Hide: ${path}` written
 * here would go straight into the on-disk rules file — locale-neutral storage, forever, regardless
 * of what language the UI runs in later. This rule stays pure data (the path is already carried by
 * its `pathEquals` condition, needed for matching regardless); `hiddenRuleLabel` below builds the
 * human-readable text from that data at the one place it is shown, in whatever locale is active
 * then.
 */
function hideRuleFor(node: ClassifiedNode): Rule {
  return {
    // `node:crypto`'s `randomUUID`, not `globalThis.crypto` (only global since Node 19 — the
    // extension bundle targets `node18`, AGENTS.md "Tooling vs. runtime Node version"). No
    // stability requirement on this id beyond "does not collide with another hide rule", unlike a
    // rule id a user might reference from `primaryAction` elsewhere.
    id: `${HIDDEN_RULE_ID_PREFIX}${randomUUID()}`,
    // `all` of inRoot + pathEquals, not pathEquals alone: pathFromRoot is root-relative, and two
    // different roots can share a relative path — inRoot pins the rule to this one node, not to
    // every node at that relative path across every configured root.
    when: {
      kind: 'all',
      of: [
        { kind: 'inRoot', rootId: node.facts.rootId },
        // pathEquals, never a regex: the path may contain regex metacharacters (`(`, `+`, `[`,
        // ...) that a nameMatches/pathMatches rule would have to escape, and a rule built from raw
        // user data must not require that (04-actions.md, package 04-E task text).
        { kind: 'pathEquals', path: node.facts.pathFromRoot },
      ],
    },
    verdict: { skip: true },
  };
}

/**
 * The path `hideRuleFor` pinned its `pathEquals` condition to, recovered from `when` — the same
 * shape `hideRuleFor` builds, walked back rather than carried alongside it as a separate field, so
 * there is exactly one place that shape is described.
 */
function pathEqualsPathOf(condition: Condition): string | undefined {
  if (condition.kind !== 'all') return undefined;
  for (const child of condition.of) {
    if (child.kind === 'pathEquals') return child.path;
  }
  return undefined;
}

/**
 * Human-readable text for one hidden-rule QuickPick row, built at display time so it reflects
 * whatever locale is active *now* (R07-L10N-BYPASS) — never the locale active when "Hide" wrote the
 * rule, which `title` would have frozen in on disk forever. Falls back to `rule.title ?? rule.id`
 * for a hide rule that predates this fix (already on disk with an English `title`) or does not
 * match the expected shape for any other reason — old data is shown as-is, not discarded.
 */
function hiddenRuleLabel(rule: Rule): string {
  const path = pathEqualsPathOf(rule.when);
  return path === undefined ? (rule.title ?? rule.id) : vscode.l10n.t('Hide: {0}', path);
}

/**
 * `node.facts.entries` reflects a real directory read only when `node.entriesRead` is `true`
 * (`discovery/walker.ts`'s own doc comment on the field) — the walker skips reading a directory it
 * did not need to classify the node with the *rules active at discovery time*, leaving `entries` at
 * `[]` indistinguishable from a genuinely empty directory. "Hide" reclassifies against
 * `effectiveRules` freshly re-read from disk (see below), which can differ from what the walker
 * last used — a `hasChild` rule added to the file after the last tree refresh would then be checked
 * against a facts object this command never actually verified against the filesystem, silently
 * deciding "not hidden" from an incomplete listing (review-07, native-claude-03). Reading the
 * directory here when needed, rather than trusting `entries` at face value, closes that gap; a
 * failed read (directory removed since discovery) falls back to the walker's own facts rather than
 * blocking "Hide" on a filesystem error unrelated to the rule being written.
 */
async function currentEntries(
  node: ClassifiedNode,
  fs: FileSystemReader,
): Promise<readonly DirEntry[]> {
  if (node.entriesRead) return node.facts.entries;
  try {
    return await fs.readDirectory(node.facts.absolutePath);
  } catch {
    return node.facts.entries;
  }
}

/**
 * "Hide": prepends a `skip: true` rule for the resolved node to the canonical rules file, unless the
 * node is already hidden by a rule that outranks it — first-match per field (`classifier.ts`) means
 * prepending a second, lower-priority `skip` rule for an already-hidden node would never be
 * consulted, i.e. exactly the "мёртвое правило" the plan's DoD forbids.
 */
export function registerHideCommand(
  location: RulesFileLocation,
  knownActionIds: readonly string[],
  refresh: () => Promise<void>,
  selection: NodeSelection,
  fs: FileSystemReader,
): vscode.Disposable {
  return vscode.commands.registerCommand(HIDE_COMMAND, async (explicitNode?: ClassifiedNode) => {
    const node = resolveNode(explicitNode, selection);
    if (node === undefined) {
      void vscode.window.showErrorMessage(vscode.l10n.t('No node is selected to hide.'));
      return;
    }

    const { file, diagnostics } = await readRulesFileForEdit(location, knownActionIds);
    if (file === undefined) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          'The rules file has a problem and cannot be edited: {0}',
          diagnostics[0]?.message ?? '',
        ),
      );
      return;
    }

    // The effective ruleset the tree actually classifies with — user rules layered over the
    // defaults, exactly `loadCanonicalRules`'s own merge (`editor/rules/canonical-rules.ts`) —
    // reproduced here rather than imported, since that function also does the disk read this
    // command already did through `readRulesFileForEdit`.
    const effectiveRules = [...file.rules, ...DEFAULT_RULES];
    const entries = await currentEntries(node, fs);
    const verdict = createClassifier(effectiveRules).classify({ ...node.facts, entries });
    if (verdict.skip.value) {
      void vscode.window.showInformationMessage(
        verdict.skip.byRule === undefined
          ? vscode.l10n.t('"{0}" is already hidden.', node.facts.name)
          : vscode.l10n.t(
              '"{0}" is already hidden by rule "{1}".',
              node.facts.name,
              verdict.skip.byRule,
            ),
      );
      return;
    }

    const result = await writeRulesFile(
      location,
      { version: file.version, rules: [hideRuleFor(node), ...file.rules], actions: file.actions },
      file.mtimeMs,
    );
    if (!result.ok) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          'Could not hide "{0}": the rules file changed on disk since it was read. Try again.',
          node.facts.name,
        ),
      );
      return;
    }

    await refresh();
  });
}

interface HiddenRuleQuickPickItem extends vscode.QuickPickItem {
  readonly rule: Rule;
}

/**
 * "Manage Hidden…": lets the user un-hide one or more nodes previously hidden through "Hide" —
 * `canPickMany: true` so several can be restored in one pass rather than reopening the picker per
 * node. Removing a rule here can only ever *reveal* a node, never hide a different one, so no
 * `checkExternalModification`-style "would this create a dead rule" check applies the way it does
 * for "Hide".
 */
export function registerManageHiddenCommand(
  location: RulesFileLocation,
  knownActionIds: readonly string[],
  refresh: () => Promise<void>,
): vscode.Disposable {
  return vscode.commands.registerCommand(MANAGE_HIDDEN_COMMAND, async () => {
    const { file, diagnostics } = await readRulesFileForEdit(location, knownActionIds);
    if (file === undefined) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          'The rules file has a problem and cannot be edited: {0}',
          diagnostics[0]?.message ?? '',
        ),
      );
      return;
    }

    const hiddenRules = file.rules.filter((rule) => isHiddenRule(rule));
    if (hiddenRules.length === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t('Nothing is hidden.'));
      return;
    }

    const items: HiddenRuleQuickPickItem[] = hiddenRules.map((rule) => ({
      label: hiddenRuleLabel(rule),
      rule,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: vscode.l10n.t('Select hidden items to show again'),
    });
    if (picked === undefined || picked.length === 0) return;

    const idsToRestore = new Set(picked.map((item) => item.rule.id));
    const remainingRules = file.rules.filter((rule) => !idsToRestore.has(rule.id));

    const result = await writeRulesFile(
      location,
      { version: file.version, rules: remainingRules, actions: file.actions },
      file.mtimeMs,
    );
    if (!result.ok) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t(
          'Could not update hidden items: the rules file changed on disk since it was read. Try again.',
        ),
      );
      return;
    }

    await refresh();
  });
}
