/**
 * Reads `projectsTree.roots` and `projectsTree.showRootNodes`. `scope: machine` in `package.json`
 * (docs/plans/projects-tree/04-actions.md, package 04-B) already keeps a workspace's own
 * `.vscode/settings.json` from overriding `roots` — this module only has to reject a shape VS
 * Code's own type check let through (each entry is `string | { path, label? }`, but nothing stops
 * an empty string, a relative path, or an object with a non-string `path`).
 */
import nodePath from 'node:path';
import * as vscode from 'vscode';
import type { DiscoveryRoot } from '../../projects/discovery/index.js';

const SECTION = 'projectsTree';

/**
`docs/plans/projects-tree/00-overview.md`, "Корень — контейнер, а не узел": grouping is decided in
the adapter, not the core, so `label` lives here — `DiscoveryRoot` (what the core accepts) has no
room for it and does not need one. A `ConfiguredRoot` is still a valid `DiscoveryRoot` (`id`,
`path`), just with one extra field.
*/
export interface ConfiguredRoot extends DiscoveryRoot {
  readonly label?: string;
}

export interface RootsReadResult {
  readonly roots: readonly ConfiguredRoot[];
  /**
  String renderings of setting entries that were neither a valid absolute-path string nor a valid
  `{ path, label? }` object, reported to the user by the caller rather than silently dropped.
  */
  readonly invalid: readonly string[];
  /**
  Ids (== paths, see `parseRootEntry`) of entries that repeated one already accepted; only the first
  occurrence of each id survives into `roots`. Kept apart from `invalid` — a duplicate is a
  well-formed root, just a repeat, so warning text built for "not an absolute path" would mislabel it
  (review-06, claude-01).

  Detected by exact string equality on `id` only. Two *different* strings can still name the same
  directory — a trailing separator, a symlink, or a case difference on a case-insensitive filesystem
  — and this reader deliberately does not catch any of those: normalizing an id would mean this
  synchronous, side-effect-free function making a `realpath`/case-lookup filesystem call, and would
  also change the id `discoverProjectTree`/`NodeKey` key on for every existing root, not just
  duplicated ones. Left as a named limitation rather than solved here.
  */
  readonly duplicates: readonly string[];
}

export function readRoots(): RootsReadResult {
  const raw = vscode.workspace.getConfiguration(SECTION).get<unknown>('roots');
  const values = Array.isArray(raw) ? raw : [];
  const roots: ConfiguredRoot[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seenIds = new Set<string>();
  for (const value of values) {
    const parsed = parseRootEntry(value);
    if (parsed === undefined) {
      invalid.push(typeof value === 'string' ? value : JSON.stringify(value));
      continue;
    }
    if (seenIds.has(parsed.id)) {
      duplicates.push(parsed.id);
      continue;
    }
    seenIds.add(parsed.id);
    roots.push(parsed);
  }
  return { roots, invalid, duplicates };
}

function parseRootEntry(value: unknown): ConfiguredRoot | undefined {
  if (typeof value === 'string') {
    // The path doubles as the root's id: it is stable across sessions and, unlike an index,
    // survives a reorder of the setting without changing every node's NodeKey.
    const normalized = normalizeRootPath(value);
    return normalized === undefined ? undefined : { id: normalized, path: normalized };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.path !== 'string') return undefined;
  const rootPath = normalizeRootPath(record.path);
  if (rootPath === undefined) return undefined;

  const label = record.label;
  if (label !== undefined && (typeof label !== 'string' || label.length === 0)) return undefined;

  return label === undefined
    ? { id: rootPath, path: rootPath }
    : { id: rootPath, path: rootPath, label };
}

/**
An absolute path with any trailing separator removed, or `undefined` when the value is not usable as
a root at all.

Trimming the separator here rather than when deduplicating is the point: the result becomes the
root's `id`, which is what `NodeKey` and every piece of stored per-node state are keyed on, so
`/a/b` and `/a/b/` must not be two different roots. Copying a path out of a terminal is how the
trailing form gets into the setting, and without this the user sees the same subtree twice under two
groups (review-06, claude-01).

Deliberately string-only. Two different strings can still name one directory through a symlink, or
through a case difference on a case-insensitive filesystem, and neither is caught here: resolving
those needs a filesystem call from what is a synchronous, side-effect-free settings read, and it
would rewrite the `id` of every existing root — discarding the stored expansion state of users who
have no duplicates at all. Named limitation; `identity()` in `discovery/file-system.ts` is where a
real answer would come from once stage 07 already touches this state.

A root path of exactly the filesystem root (`/`, or `C:\`) keeps its separator: it *is* the
separator, and stripping it would leave an empty or relative string.
*/
function normalizeRootPath(value: string): string | undefined {
  if (value.length === 0 || !nodePath.isAbsolute(value)) return undefined;
  const trimmed = value.replace(/[\\/]+$/, '');
  return trimmed.length > 0 && nodePath.isAbsolute(trimmed) ? trimmed : value;
}

export type ShowRootNodes = 'auto' | 'always' | 'never';

const DEFAULT_SHOW_ROOT_NODES: ShowRootNodes = 'auto';

export function readShowRootNodes(): ShowRootNodes {
  const raw = vscode.workspace.getConfiguration(SECTION).get<unknown>('showRootNodes');
  return raw === 'always' || raw === 'never' ? raw : DEFAULT_SHOW_ROOT_NODES;
}

/**
Where the tree is shown. Owned here rather than in `tree-view/location.ts` for the same reason as
`ShowRootNodes`: it is the value space of a setting, and `configuration/` is what turns settings into
types the rest of the adapter can trust.
*/
export type TreeLocation = 'activityBar' | 'explorer' | 'none';

const DEFAULT_LOCATION: TreeLocation = 'activityBar';

/**
Unknown values fall back to the default rather than hiding the tree: `location` decides whether the
user sees anything at all, so a typo in settings.json must not produce an empty editor with no
explanation.
*/
export function readLocation(): TreeLocation {
  const raw = vscode.workspace.getConfiguration(SECTION).get<unknown>('location');
  return raw === 'explorer' || raw === 'none' ? raw : DEFAULT_LOCATION;
}

/**
Cost limiter for the walk (04-actions.md, package 04-B table): `discoverProjectTree` counts depth
from the root itself, so 0 returns no children at all and 1 returns only each root's immediate
children, unexpanded. `scope: machine` — a workspace cannot inflate the cost of scanning a
machine it does not own.
*/
const DEFAULT_MAX_DEPTH = 4;

/**
Any value that is not a non-negative integer falls back to the default, matching `readShowRootNodes`
and `readLocation`: a malformed setting must not throw or silently scan with `undefined` (which
`discoverProjectTree` would treat differently only by accident).
*/
export function readMaxDepth(): number {
  const raw = vscode.workspace.getConfiguration(SECTION).get<unknown>('maxDepth');
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : DEFAULT_MAX_DEPTH;
}

/**
The id of the action `commands/actionPicker.ts` (package 04-C) runs when a node's verdict names no
`primaryAction`. Read as an opaque string here — the set of valid ids belongs to
`src/projects/actions/**`, which this module does not import, so nothing here can validate against
it; an id that resolves to nothing is 04-C's problem to report.
*/
const DEFAULT_ACTION_ID = 'builtin.openInNewWindow';

export function readDefaultAction(): string {
  const raw = vscode.workspace.getConfiguration(SECTION).get<unknown>('defaultAction');
  return typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_ACTION_ID;
}

export function onTreeConfigurationChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration(`${SECTION}.roots`) ||
      event.affectsConfiguration(`${SECTION}.showRootNodes`) ||
      event.affectsConfiguration(`${SECTION}.location`) ||
      event.affectsConfiguration(`${SECTION}.maxDepth`) ||
      event.affectsConfiguration(`${SECTION}.defaultAction`)
    ) {
      listener();
    }
  });
}
