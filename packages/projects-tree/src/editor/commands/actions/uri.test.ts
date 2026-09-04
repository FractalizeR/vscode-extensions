import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderError, type ActionRenderNode } from '../../../projects/actions/index.js';

interface FakeUri {
  toString(): string;
}

const openExternalMock = vi.fn<(target: FakeUri) => Promise<boolean>>().mockResolvedValue(true);
const showErrorMessageMock = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('vscode', () => ({
  Uri: {
    parse: (value: string, requiresScheme?: boolean): FakeUri => {
      if (requiresScheme === true && !/^[a-z][a-z\d+.-]*:/i.test(value)) {
        throw new Error(`cannot parse "${value}": no scheme`);
      }
      return { toString: () => value };
    },
  },
  env: { openExternal: openExternalMock },
  window: { showErrorMessage: showErrorMessageMock },
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replaceAll(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { runUri } = await import('./uri.js');

function node(path: string): ActionRenderNode {
  return { path, name: 'proj', parentPath: '/work', rootPath: '/work' };
}

beforeEach(() => {
  openExternalMock.mockClear();
  showErrorMessageMock.mockClear();
});

describe('runUri', () => {
  it('renders the template with URI (percent-encoding) protection and opens it externally', async () => {
    await runUri({ kind: 'uri', template: 'phpstorm://open?file=${path}' }, node('/work/a b'));

    expect(openExternalMock).toHaveBeenCalledTimes(1);
    const target = openExternalMock.mock.calls[0]?.[0];
    expect(target?.toString()).toBe('phpstorm://open?file=%2Fwork%2Fa%20b');
  });

  it('reports a clear error for a template that renders to a schemeless value, and opens nothing', async () => {
    await runUri({ kind: 'uri', template: '${name}' }, node('/work/proj'));

    expect(openExternalMock).not.toHaveBeenCalled();
    expect(showErrorMessageMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a newline in the substituted value before ever reaching Uri.parse', async () => {
    await expect(
      runUri({ kind: 'uri', template: 'x://${path}' }, node('/work/a\nb')),
    ).rejects.toThrow(RenderError);
    expect(openExternalMock).not.toHaveBeenCalled();
  });
});
