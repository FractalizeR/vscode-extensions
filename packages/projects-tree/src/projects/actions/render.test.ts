import { describe, expect, it } from 'vitest';
import { RenderError, type RenderTarget } from './action';
import { render, type ActionRenderNode } from './render';

function node(overrides: Partial<ActionRenderNode> = {}): ActionRenderNode {
  return {
    path: '/home/dev/work/my-project',
    name: 'my-project',
    parentPath: '/home/dev/work',
    rootPath: '/home/dev/work',
    ...overrides,
  };
}

const SHELL: RenderTarget = { kind: 'shell', shell: 'zsh' };
const URI: RenderTarget = { kind: 'uri' };
const LITERAL: RenderTarget = { kind: 'literal' };

describe('render — literal template text is never quoted', () => {
  it('renders "cd ${path} && opencode" as two shell commands, not one quoted argument', () => {
    // Regression for the review finding this package fixes: an earlier design quoted the whole
    // rendered string (having returned it "untrusted" as one unit), which also swallowed the
    // "&&" the action author typed by hand into the single quoted argument — turning two
    // commands into one broken one. Quoting only the substituted value at the point of
    // substitution means the literal " && opencode" the author wrote survives untouched.
    const result = render('cd ${path} && opencode', node({ path: '/tmp/my project' }), SHELL);
    expect(result).toBe("cd '/tmp/my project' && opencode");
    // The literal "&&" is unquoted shell syntax, not embedded inside any quoted region.
    expect(result).not.toContain("'&&'");
    expect(result.includes(' && ')).toBe(true);
  });

  it('leaves every literal character of a template with no substitutions untouched', () => {
    const template = 'echo "hello world" ; echo done';
    expect(render(template, node(), SHELL)).toBe(template);
  });
});

describe('render — value with a newline is always rejected', () => {
  it('rejects "${name}" containing a newline regardless of target — a directory named across two lines must not become two commands', () => {
    // Regression: terminal.execute defaults to false (a rendered command is inserted, not run —
    // api-facts.md fact 11), which is the main defense against a hostile directory name. A "\n"
    // inside a substituted value defeats that defense by acting as the Enter-press the user never
    // made, executing everything before it regardless of `execute` or of how well the rest of the
    // value was quoted.
    const hostile = node({ name: 'innocuous\nrm -rf ~' });

    expect(() => render('open ${name}', hostile, SHELL)).toThrow(RenderError);
    try {
      render('open ${name}', hostile, SHELL);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe('newlineInValue');
    }
  });

  it('rejects a value containing a CRLF line ending the same way', () => {
    const hostile = node({ path: '/tmp/a\r\nb' });
    expect(() => render('${path}', hostile, SHELL)).toThrow(RenderError);
  });

  it('rejects the newline independently of the render target (uri, literal)', () => {
    const hostile = node({ name: 'a\nb' });
    expect(() => render('${name}', hostile, URI)).toThrow(RenderError);
    expect(() => render('${name}', hostile, LITERAL)).toThrow(RenderError);
  });
});

describe('render — uri target encodes, never concatenates', () => {
  it('percent-encodes a substituted value instead of splicing it into the URI raw', () => {
    const hostile = node({ path: '/tmp/a?evil=1&b=2#frag' });
    const result = render('vscode://open?path=${path}', hostile, URI);
    expect(result).toBe('vscode://open?path=%2Ftmp%2Fa%3Fevil%3D1%26b%3D2%23frag');
    // Decisive check: the raw value must not appear verbatim anywhere in the output — if it did,
    // "encoding" would have degenerated into "concatenation".
    expect(result).not.toContain(hostile.path);
  });

  it('leaves the literal parts of a uri template (scheme, separators) untouched', () => {
    const result = render('vscode://open?path=${path}&x=1', node(), URI);
    expect(result.startsWith('vscode://open?path=')).toBe(true);
    expect(result.endsWith('&x=1')).toBe(true);
  });
});

describe('render — literal target', () => {
  it('inserts the value as-is, with no quoting', () => {
    expect(render('Terminal: ${name}', node({ name: 'my-project' }), LITERAL)).toBe(
      'Terminal: my-project',
    );
  });
});

describe('render — unknown template variable', () => {
  it('throws a diagnostic instead of substituting an empty string', () => {
    expect(() => render('${bogus}', node(), SHELL)).toThrow(RenderError);
    try {
      render('${bogus}', node(), SHELL);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe('unknownVariable');
    }
  });
});

describe('render — ${workspaceFile}', () => {
  it('substitutes it (shell-quoted) when a workspace file is open', () => {
    const withFile = node({ workspaceFile: '/home/dev/work.code-workspace' });
    expect(render('${workspaceFile}', withFile, SHELL)).toBe("'/home/dev/work.code-workspace'");
  });

  it('throws a diagnostic, not an empty substitution, when no workspace file is open', () => {
    expect(() => render('${workspaceFile}', node(), SHELL)).toThrow(RenderError);
    try {
      render('${workspaceFile}', node(), SHELL);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe('missingValue');
    }
  });
});

describe('render — every known substitution is wired to the right field', () => {
  it('resolves path, name, parentPath and rootPath to their respective node fields', () => {
    const n = node({
      path: '/roots/work/my-project',
      name: 'my-project',
      parentPath: '/roots/work',
      rootPath: '/roots/work',
    });
    expect(render('${path}|${name}|${parentPath}|${rootPath}', n, LITERAL)).toBe(
      '/roots/work/my-project|my-project|/roots/work|/roots/work',
    );
  });

  it('substitutes the same variable more than once in one template', () => {
    expect(render('${name} / ${name}', node({ name: 'x' }), LITERAL)).toBe('x / x');
  });
});

describe('render — shell target actually quotes a hostile substituted value', () => {
  it('renders a command-injection attempt as one inert quoted argument, not a second command', () => {
    const hostile = node({ name: 'proj; rm -rf ~' });
    const result = render('cd ${name}', hostile, SHELL);
    expect(result).toBe("cd 'proj; rm -rf ~'");
  });
});
