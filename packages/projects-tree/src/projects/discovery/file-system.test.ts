import { describe, expect, it } from 'vitest';
import { createNodeFileSystemReader, FileSystemError } from './file-system.js';

// Exercised against real files checked into __fixtures__/sample-dir — not created by this test
// file, because src/projects/** may import node:fs only from file-system.ts itself
// (.dependency-cruiser.mjs, no-node-builtins-in-core-logic): a test that shelled out to node:fs to
// build its own temp directory would violate that rule from inside its own package.
const FIXTURE_DIR = new URL('__fixtures__/sample-dir', import.meta.url).pathname;

describe('createNodeFileSystemReader — readDirectory', () => {
  it('lists real entries with their type', async () => {
    const reader = createNodeFileSystemReader();

    const entries = await reader.readDirectory(FIXTURE_DIR);

    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    expect(byName.get('file-a.txt')).toEqual({ name: 'file-a.txt', type: 'file' });
    expect(byName.get('child-dir')).toEqual({ name: 'child-dir', type: 'dir' });
    expect(byName.size).toBe(5);
  });

  it('reports a directory symlink with a resolved dir target and an identity', async () => {
    const reader = createNodeFileSystemReader();

    const entries = await reader.readDirectory(FIXTURE_DIR);
    const symlink = entries.find((entry) => entry.name === 'dir-symlink');

    expect(symlink?.type).toBe('symlink');
    expect(symlink?.symlinkTarget?.type).toBe('dir');
    expect(symlink?.symlinkTarget?.deviceAndInode).toMatch(/^\d+:\d+$/);
  });

  it('reports a broken symlink without a device/inode', async () => {
    const reader = createNodeFileSystemReader();

    const entries = await reader.readDirectory(FIXTURE_DIR);
    const symlink = entries.find((entry) => entry.name === 'broken-symlink');

    expect(symlink?.type).toBe('symlink');
    expect(symlink?.symlinkTarget).toEqual({ type: 'broken' });
  });

  it('rejects with a notFound FileSystemError for a path that does not exist', async () => {
    const reader = createNodeFileSystemReader();

    await expect(reader.readDirectory(`${FIXTURE_DIR}/does-not-exist`)).rejects.toMatchObject({
      constructor: FileSystemError,
      code: 'notFound',
    });
  });

  it('rejects with a notDirectory FileSystemError when the path is a file', async () => {
    const reader = createNodeFileSystemReader();

    await expect(reader.readDirectory(`${FIXTURE_DIR}/file-a.txt`)).rejects.toMatchObject({
      constructor: FileSystemError,
      code: 'notDirectory',
    });
  });
});

describe('createNodeFileSystemReader — readFile', () => {
  it('reads a small file whole', async () => {
    const reader = createNodeFileSystemReader();

    const content = await reader.readFile(`${FIXTURE_DIR}/file-a.txt`, 1024);

    expect(content).toBe('hello');
  });

  it('truncates at maxBytes instead of reading the whole file', async () => {
    // big-file.txt is 200 bytes of 'x'; the maxBytes guard exists so a gigantic file at the
    // location a small config file (.gitmodules, package 02-E) is expected cannot be read whole.
    const reader = createNodeFileSystemReader();

    const content = await reader.readFile(`${FIXTURE_DIR}/big-file.txt`, 10);

    expect(content).toBe('x'.repeat(10));
  });
});

describe('createNodeFileSystemReader — identity', () => {
  it('is stable across two calls for the same path', async () => {
    const reader = createNodeFileSystemReader();

    const first = await reader.identity(`${FIXTURE_DIR}/child-dir`);
    const second = await reader.identity(`${FIXTURE_DIR}/child-dir`);

    expect(first).toBe(second);
  });

  it('differs between two distinct directories', async () => {
    const reader = createNodeFileSystemReader();

    const sample = await reader.identity(FIXTURE_DIR);
    const child = await reader.identity(`${FIXTURE_DIR}/child-dir`);

    expect(sample).not.toBe(child);
  });

  it('matches the target identity when resolved through a directory symlink', async () => {
    // The walker's cycle guard (walker.ts) relies on this: identity() following the symlink is
    // what lets it recognize "this symlink leads back to a directory already visited".
    const reader = createNodeFileSystemReader();

    const viaSymlink = await reader.identity(`${FIXTURE_DIR}/dir-symlink`);
    const direct = await reader.identity(`${FIXTURE_DIR}/child-dir`);

    expect(viaSymlink).toBe(direct);
  });

  it('rejects with a notFound FileSystemError for a broken symlink', async () => {
    const reader = createNodeFileSystemReader();

    await expect(reader.identity(`${FIXTURE_DIR}/broken-symlink`)).rejects.toMatchObject({
      constructor: FileSystemError,
      code: 'notFound',
    });
  });
});
