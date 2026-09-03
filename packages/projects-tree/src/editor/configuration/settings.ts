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
}

export function readRoots(): RootsReadResult {
  const raw = vscode.workspace.getConfiguration(SECTION).get<unknown>('roots');
  const values = Array.isArray(raw) ? raw : [];
  const roots: ConfiguredRoot[] = [];
  const invalid: string[] = [];
  for (const value of values) {
    const parsed = parseRootEntry(value);
    if (parsed === undefined) {
      invalid.push(typeof value === 'string' ? value : JSON.stringify(value));
      continue;
    }
    roots.push(parsed);
  }
  return { roots, invalid };
}

function parseRootEntry(value: unknown): ConfiguredRoot | undefined {
  if (typeof value === 'string') {
    // The path doubles as the root's id: it is stable across sessions and, unlike an index,
    // survives a reorder of the setting without changing every node's NodeKey.
    return isValidRootPath(value) ? { id: value, path: value } : undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const rootPath = record.path;
  if (typeof rootPath !== 'string' || !isValidRootPath(rootPath)) return undefined;

  const label = record.label;
  if (label !== undefined && (typeof label !== 'string' || label.length === 0)) return undefined;

  return label === undefined
    ? { id: rootPath, path: rootPath }
    : { id: rootPath, path: rootPath, label };
}

function isValidRootPath(value: string): boolean {
  return value.length > 0 && nodePath.isAbsolute(value);
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

export function onTreeConfigurationChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration(`${SECTION}.roots`) ||
      event.affectsConfiguration(`${SECTION}.showRootNodes`) ||
      event.affectsConfiguration(`${SECTION}.location`)
    ) {
      listener();
    }
  });
}
