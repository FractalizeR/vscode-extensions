import { describe, expect, it } from 'vitest';
import {
  render,
  renderArgs,
  renderCommandArgs,
  RenderError,
  encodeForUri,
  quoteForShell,
  type ActionDefinition,
  type ActionRenderNode,
  type ActionSpec,
  type RenderErrorReason,
  type RenderTarget,
  type ShellKind,
} from './index';

/**
 * Nothing outside actions/ wires this module in yet (the editor adapter that runs `ActionSpec`s is
 * a later stage), so this file is the only thing exercising the barrel — `index.ts`, the file every
 * other subject must go through per dependency-cruiser's no-sibling-internals rule. It touches
 * every exported name deliberately, the same way classification/index.test.ts does.
 */
describe('actions/index — public surface', () => {
  it('exposes render, quoted for a shell target, through the barrel', () => {
    const node: ActionRenderNode = {
      path: '/work/my-project',
      name: 'my-project',
      parentPath: '/work',
      rootPath: '/work',
    };
    const target: RenderTarget = { kind: 'shell', shell: 'zsh' };
    expect(render('cd ${path}', node, target)).toBe("cd '/work/my-project'");
  });

  it('exposes RenderError with its reason, thrown by render for an unknown variable', () => {
    const node: ActionRenderNode = {
      path: '/work/my-project',
      name: 'my-project',
      parentPath: '/work',
      rootPath: '/work',
    };
    try {
      render('${bogus}', node, { kind: 'literal' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      const reason: RenderErrorReason = (error as RenderError).reason;
      expect(reason).toBe('unknownVariable');
    }
  });

  it('exposes quoteForShell and encodeForUri as standalone quoting primitives', () => {
    const shell: ShellKind = 'bash';
    expect(quoteForShell("it's", shell)).toBe(String.raw`'it'\''s'`);
    expect(encodeForUri('a b')).toBe('a%20b');
  });

  it('exposes ActionSpec/ActionDefinition as the shape rules and 02-B validate against', () => {
    const spec: ActionSpec = { kind: 'openFolder', window: 'auto' };
    const action: ActionDefinition = { id: 'open', spec };
    expect(action.spec).toEqual(spec);
  });

  it('exposes renderArgs and renderCommandArgs, rendering ActionSpec.process/command args through the barrel', () => {
    const node: ActionRenderNode = {
      path: '/work/my-project',
      name: 'my-project',
      parentPath: '/work',
      rootPath: '/work',
    };
    expect(renderArgs(['${path}', 'fixed'], node)).toEqual(['/work/my-project', 'fixed']);
    expect(renderCommandArgs(['${path}', 42], node)).toEqual(['/work/my-project', 42]);
  });
});
