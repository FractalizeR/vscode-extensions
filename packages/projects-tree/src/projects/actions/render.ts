import { RenderError, type RenderTarget } from './action';
import { encodeForUri, quoteForShell } from './quoting';

/**
 * The node data `${...}` substitutions in an `ActionSpec` template draw from. Deliberately not the
 * discovery subject's `ClassifiedNode` (package 02-D, not yet built alongside this package, and not
 * something `actions/` should depend on regardless — `discovery` sits between `classification` and
 * the tree the adapter walks, `actions` only needs five plain path/name strings out of it). Whatever
 * shape 02-D ends up giving nodes, deriving this narrower object from it is a one-line adapter, not
 * a redesign of this contract.
 */
export interface ActionRenderNode {
  /**
  Absolute path of the node itself. `${path}`.
  */
  readonly path: string;
  /**
  `${name}`.
  */
  readonly name: string;
  /**
  Absolute path of the node's parent directory. `${parentPath}`.
  */
  readonly parentPath: string;
  /**
  Absolute path of the root the node was discovered under. `${rootPath}`.
  */
  readonly rootPath: string;
  /**
   * Absolute path of the currently open workspace file, when one is open. `${workspaceFile}` —
   * absent (no workspace file open) is a `render` error (`missingValue`), not an empty
   * substitution: a template author who wrote `${workspaceFile}` meant for it to be there.
   */
  readonly workspaceFile?: string;
}

const VARIABLE_PATTERN = /\$\{([a-zA-Z]+)\}/g;

/**
 * Renders one `ActionSpec` template (`terminal.command`, `terminal.cwd`, `uri.template`, ...)
 * against `node`, for the sink named by `target`.
 *
 * **Quoting happens per substituted value, at the point of substitution — never on the finished
 * string.** This is the fix for a real defect: an earlier design treated the whole rendered string
 * as untrusted and quoted the result of substitution as one unit. That also quotes the *literal*
 * template text the action's author wrote by hand — `cd ${path} && opencode` stops being "run `cd`,
 * then run `opencode`" and becomes one single (and wrong) command, because the `&&` the author
 * typed gets quoted along with the path. Building the string in one pass — matching `${...}`,
 * looking up and validating the raw value, then immediately protecting *that value* for `target`
 * before splicing it back in — means there is never an intermediate unquoted, unprotected string
 * that some later step forgets to handle: the risky data is inert at the moment it is written into
 * the output, not after.
 *
 * A substituted value containing a C0 control character (U+0000–U+001F) or DEL (U+007F) is always
 * rejected — `RenderError('controlCharacterInValue')` — regardless of `target` or how well the
 * target's quoting would otherwise neutralize it. This is not redundant with quoting:
 * `terminal.execute` defaults to `false` (api-facts.md fact 11), so a rendered command is typically
 * only *inserted* into the terminal, not run — but the terminal's own line discipline, not the
 * shell's quoting, is what turns CR into a submit and lets ESC/BS reposition the cursor or spoof
 * what is on screen. A single `\r` alone is the sharpest case: it contains no `\n`, so a check that
 * only looked for `\n` (an earlier version of this function did) let it through — the pty's
 * canonical mode treats CR as Enter (`icrnl`) independently of `\n`, so a directory named
 * `a\rwhoami` executes `whoami` the moment it is inserted, defeating `execute: false` exactly like
 * a literal newline would. Rejecting the whole C0 range plus DEL, rather than enumerating just
 * `\r`/`\n`/ESC/BS, is deliberate: any C0/DEL byte is either a defined terminal control function or
 * unassigned, so none of them appear in a legitimate file or directory name on any OS this
 * extension targets — rejecting the class costs nothing there. C1 controls (U+0080–U+009F) are
 * deliberately *not* rejected: on a UTF-8 terminal (the default this codebase can assume) a
 * standalone code point in that range is emitted as a 2-byte UTF-8 sequence, not the raw 8-bit
 * control byte a terminal's legacy "8-bit controls" mode would need to interpret it as a control
 * function — a mode disabled by default on the terminals VS Code embeds. Widening the reject range
 * to C1 would risk false positives on nothing (C1 code points do not occur in real Unicode file
 * names either), so it is not a live safety trade-off either way; it is left out to keep the
 * rejected range matched to a mechanism this codebase can actually justify, rather than guessed.
 *
 * Throws `RenderError('unknownVariable')` for any `${...}` placeholder that is not one of the five
 * known variables — never silently substitutes an empty string, which would make a typo in a
 * template look like "the node has no path" instead of "the template is wrong".
 */
export function render(template: string, node: ActionRenderNode, target: RenderTarget): string {
  return template.replaceAll(VARIABLE_PATTERN, (_match, variableName: string) => {
    const value = lookupVariable(variableName, node);
    if (hasControlCharacter(value)) {
      throw new RenderError(
        'controlCharacterInValue',
        `Substituted value for "\${${variableName}}" contains a control character, which is always rejected.`,
      );
    }
    return protectForTarget(value, target);
  });
}

/**
 * Whether `value` contains a C0 control character (U+0000-U+001F) or DEL (U+007F) — see `render`'s
 * doc comment for why this whole range, and not just `\r`/`\n`, is rejected.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === 0x7f || (codePoint !== undefined && codePoint <= 0x1f)) {
      return true;
    }
  }
  return false;
}

function lookupVariable(name: string, node: ActionRenderNode): string {
  switch (name) {
    case 'path': {
      return node.path;
    }
    case 'name': {
      return node.name;
    }
    case 'parentPath': {
      return node.parentPath;
    }
    case 'rootPath': {
      return node.rootPath;
    }
    case 'workspaceFile': {
      if (node.workspaceFile === undefined) {
        throw new RenderError(
          'missingValue',
          'Template uses "${workspaceFile}" but no workspace file is open.',
        );
      }
      return node.workspaceFile;
    }
    default: {
      throw new RenderError('unknownVariable', `Unknown template variable "\${${name}}".`);
    }
  }
}

function protectForTarget(value: string, target: RenderTarget): string {
  switch (target.kind) {
    case 'shell': {
      return quoteForShell(value, target.shell);
    }
    case 'uri': {
      return encodeForUri(value);
    }
    case 'literal': {
      return value;
    }
  }
}

/**
 * Renders every element of `args` (`ActionSpec.process.args`) against `node`, target
 * `{ kind: 'literal' }`. `process` launches its argv directly, with no shell in between — there is
 * nothing to quote — but each element still goes through `render`, so the control-character
 * rejection `render`'s doc comment describes applies per element exactly as it does to
 * `terminal.command`. Without this function, an `ActionSpec.process` action would be the one sink
 * the threat model names (00-overview.md) that `render` never touches — args reach the child
 * process bypassing every check `render` performs.
 */
export function renderArgs(args: readonly string[], node: ActionRenderNode): string[] {
  return args.map((arg) => render(arg, node, { kind: 'literal' }));
}

/**
 * Renders the string elements of `args` (`ActionSpec.command.args`, passed to
 * `vscode.commands.executeCommand`) against `node`, target `{ kind: 'literal' }` — same reasoning
 * as `renderArgs`: `executeCommand` takes the array directly, no shell involved, so nothing needs
 * quoting beyond the control-character rejection `render` always applies. A non-string element
 * (number, boolean, object, array, null, …) passes through untouched: `${...}` substitution is a
 * string-template concept, so only a string argument can carry one, and an author who wants a
 * literal non-string argument writes one.
 */
export function renderCommandArgs(args: readonly unknown[], node: ActionRenderNode): unknown[] {
  return args.map((arg) =>
    typeof arg === 'string' ? render(arg, node, { kind: 'literal' }) : arg,
  );
}
