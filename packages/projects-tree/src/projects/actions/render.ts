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
 * A substituted value containing `\n` (or `\r\n`, which contains `\n`) is always rejected —
 * `RenderError('newlineInValue')` — regardless of `target` or how well the target's quoting would
 * otherwise neutralize it. This is not redundant with quoting: `terminal.execute` defaults to
 * `false` (api-facts.md fact 11), so a rendered command is typically only *inserted* into the
 * terminal, not run — but a newline inside a value is a second Enter-press the user never made,
 * which defeats that exact protection by executing the first line regardless of `execute`.
 *
 * Throws `RenderError('unknownVariable')` for any `${...}` placeholder that is not one of the five
 * known variables — never silently substitutes an empty string, which would make a typo in a
 * template look like "the node has no path" instead of "the template is wrong".
 */
export function render(template: string, node: ActionRenderNode, target: RenderTarget): string {
  return template.replaceAll(VARIABLE_PATTERN, (_match, variableName: string) => {
    const value = lookupVariable(variableName, node);
    if (value.includes('\n')) {
      throw new RenderError(
        'newlineInValue',
        `Substituted value for "\${${variableName}}" contains a newline, which is always rejected.`,
      );
    }
    return protectForTarget(value, target);
  });
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
