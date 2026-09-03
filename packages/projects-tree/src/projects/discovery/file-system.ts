/**
 * Filesystem port for the core (`docs/plans/projects-tree/02-core.md`, package 02-D).
 *
 * `walker.ts`/`tree.ts` depend only on `FileSystemReader` and never import `node:fs` themselves:
 * this file is the sole exception `.dependency-cruiser.mjs`'s `no-node-builtins-in-core-logic`
 * rule carves out of `src/projects/**`, so the rest of the core stays testable against a fake.
 */
import { open, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import type { DirEntry } from '../classification/index.js';

type SymlinkTarget = NonNullable<DirEntry['symlinkTarget']>;

export interface FileSystemReader {
  readDirectory(path: string): Promise<readonly DirEntry[]>;
  /**
  Reads at most `maxBytes` bytes of `path`, decoded as UTF-8, and truncates rather than throwing
  when the file is larger — package 02-E's guard against a gigantic file sitting where
  `.gitmodules` is expected.
  */
  readFile(path: string, maxBytes: number): Promise<string>;
  /**
  A stable identity for whatever `path` resolves to (device+inode), following symlinks. The
  walker's (package 02-D) defense against cyclic symlinks: it records the identity of every
  directory it descends into and refuses to descend into one already seen.
  */
  identity(path: string): Promise<string>;
}

export type FileSystemErrorCode = 'notFound' | 'notDirectory' | 'permissionDenied' | 'other';

/**
 * Thrown by every `FileSystemReader` implementation instead of a raw `node:fs` error, so the rest
 * of the core — which cannot import `node:fs` to inspect `error.code` — can still branch on why a
 * read failed (`walker.ts` maps `code` to a `WalkDiagnostic`).
 */
export class FileSystemError extends Error {
  readonly code: FileSystemErrorCode;

  constructor(code: FileSystemErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FileSystemError';
    this.code = code;
  }
}

/**
 * Real `FileSystemReader`, backed by `node:fs/promises`.
 */
export function createNodeFileSystemReader(): FileSystemReader {
  return {
    async readDirectory(path) {
      const dirents = await guarded(readdir(path, { withFileTypes: true }), path);
      const entries: DirEntry[] = [];
      for (const dirent of dirents) {
        const type = classifyEntryType(dirent);
        if (type === 'symlink') {
          entries.push({
            name: dirent.name,
            type,
            symlinkTarget: await resolveSymlinkTarget(joinPath(path, dirent.name)),
          });
        } else {
          entries.push({ name: dirent.name, type });
        }
      }
      return entries;
    },

    async readFile(path, maxBytes) {
      return guarded(readTruncated(path, maxBytes), path);
    },

    async identity(path) {
      const stats = await guarded(stat(path), path);
      return identityOf(stats);
    },
  };
}

async function readTruncated(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function resolveSymlinkTarget(path: string): Promise<SymlinkTarget> {
  try {
    const stats = await stat(path); // follows the link
    return { type: stats.isDirectory() ? 'dir' : 'file', deviceAndInode: identityOf(stats) };
  } catch {
    return { type: 'broken' };
  }
}

function identityOf(stats: { dev: number; ino: number }): string {
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

function classifyEntryType(dirent: Dirent): DirEntry['type'] {
  if (dirent.isSymbolicLink()) return 'symlink';
  if (dirent.isDirectory()) return 'dir';
  if (dirent.isFile()) return 'file';
  return 'other';
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`;
}

async function guarded<T>(operation: Promise<T>, path: string): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    throw toFileSystemError(error, path);
  }
}

function toFileSystemError(error: unknown, path: string): FileSystemError {
  const code = hasErrorCode(error) ? error.code : undefined;
  if (code === 'ENOENT') {
    return new FileSystemError('notFound', `No such file or directory: ${path}`, { cause: error });
  }
  if (code === 'ENOTDIR') {
    return new FileSystemError('notDirectory', `Not a directory: ${path}`, { cause: error });
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new FileSystemError('permissionDenied', `Permission denied: ${path}`, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new FileSystemError('other', message, { cause: error });
}

function hasErrorCode(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error;
}
