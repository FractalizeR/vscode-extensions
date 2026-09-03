// Public surface of the discovery subject. Sibling subjects (classification/, actions/) must go
// through this file rather than importing discovery/*'s internals directly — machine-checked by
// dependency-cruiser's no-sibling-internals rule.

export { CancellationError, CancellationSource } from './cancellation.js';
export type { CancellationSignal } from './cancellation.js';
export { GenerationTracker } from './generation.js';
export type { CommitOutcome, Generation } from './generation.js';
export { createNodeFileSystemReader, FileSystemError } from './file-system.js';
export type { FileSystemErrorCode, FileSystemReader } from './file-system.js';
export { discoverProjectTree } from './tree.js';
export type {
  ClassifiedNode,
  DiscoverOptions,
  DiscoverResult,
  DiscoveryRoot,
  WalkDiagnostic,
  WalkDiagnosticKind,
} from './tree.js';
export { childrenOfProject } from './descend.js';
export type {
  DescendContext,
  DescendDiagnostic,
  DescendDiagnosticKind,
  DescendResult,
  DescendStrategy,
} from './descend.js';
export { parseGitmodules, GitmodulesParseError } from './gitmodules.js';
export type { GitmoduleEntry } from './gitmodules.js';
