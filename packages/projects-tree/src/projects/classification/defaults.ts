import type { Rule } from './rule';

/**
 * Reproduces the prototype's behavior (docs/plans/projects-tree/prototype-surface.md,
 * "Настройки" — `projectLobby.ignoreFolders`, and "Возможности из README" — stopping descent on a
 * `.git` folder), expressed as rules instead of hardcoded checks — the whole point of 02-A/B.
 *
 * Order is priority order (first-match per field, see classifier.ts):
 *
 * 1. `repo-marker` answers `skip` (false), `project` and `stopDescend` for any directory carrying a
 *    `.git` or `.idea` entry. `entryType: 'any'` is deliberate, not a default left alone: a git
 *    submodule's `.git` is a *file*, not a directory, and an entryType:'dir' condition would miss it
 *    (docs/plans/projects-tree/02-core.md, package 02-B).
 * 2. `ignored-folders` skips the exact prototype `ignoreFolders` list.
 * 3. `hidden-folders` skips dot-prefixed names.
 *
 * (2) and (3) never contest (1) for the `skip` field: `resolveField` (classifier.ts) is first-match
 * per field, and (1) claims `skip` for every marker directory before either later rule is reached —
 * that ordering is exactly what keeps a hidden repository folder (e.g. `.dotfiles` containing `.git`)
 * visible. Reversing (1) and (3) is the regression this default set's test suite guards against.
 */
export const DEFAULT_RULES: readonly Rule[] = [
  {
    id: 'repo-marker',
    title: 'Git or IDE project marker',
    when: { kind: 'hasChild', names: ['.git', '.idea'], entryType: 'any' },
    verdict: { skip: false, project: true, stopDescend: true },
  },
  {
    id: 'ignored-folders',
    title: 'Prototype ignoreFolders defaults',
    when: {
      kind: 'nameMatches',
      pattern: String.raw`^(node_modules|\.git|bin|obj|dist|\.vs|\.vscode)$`,
    },
    verdict: { skip: true },
  },
  {
    id: 'hidden-folders',
    title: 'Hidden folders, unless they are themselves a repository',
    when: { kind: 'nameMatches', pattern: String.raw`^\..+` },
    verdict: { skip: true },
  },
];
