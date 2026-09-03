import type { Condition } from '../classification';

/**
 * The four shells `render`/`quoting` know how to quote for. Fixed and closed — quoting rules are
 * hand-written per shell (docs/plans/projects-tree/02-core.md, package 02-F); adding a fifth shell
 * means adding a quoting rule, not a config flag.
 */
export type ShellKind = 'zsh' | 'bash' | 'powershell' | 'cmd';

/**
 * What an `ActionSpec.terminal.command`/`ActionSpec.uri.template` string is being rendered for.
 * `render` uses this to pick how each *substituted value* is protected — never the template as a
 * whole (see `render.ts`'s doc comment for why the whole-string approach was rejected).
 *
 * - `shell`: the string is typed into a terminal running `shell` — substituted values are quoted
 *   with that shell's rules.
 * - `uri`: the string is a URI template — substituted values are percent-encoded.
 * - `literal`: the string reaches no interpreter (e.g. a terminal tab name) — substituted values
 *   are inserted as-is. Newline rejection (see `render.ts`) still applies unconditionally.
 */
export type RenderTarget =
  { kind: 'shell'; shell: ShellKind } | { kind: 'uri' } | { kind: 'literal' };

/**
 * One configured action a user can run against a classified node. `kind: 'openFolder'` and
 * `kind: 'command'` carry no template — nothing here for `render` to touch. `kind: 'terminal'`,
 * `kind: 'process'` and `kind: 'uri'` carry the sinks the threat model calls out (00-overview.md,
 * "Модель угроз"): a shell, an argv array, and a URI.
 */
export type ActionSpec =
  | { kind: 'openFolder'; window: 'current' | 'new' | 'auto' }
  | {
      kind: 'terminal';
      /**
      A `render` template, target `{ kind: 'shell'; shell }`.
      */
      command: string;
      /**
       * Which shell the terminal is created with (`Terminal`'s `shellPath`, api-facts.md fact 12).
       * Required, not inferred from user settings: quoting rules differ per shell, and guessing
       * from `terminal.integrated.defaultProfile` would make the guess — not the actual shell the
       * command runs in — the thing that decides whether quoting is correct.
       */
      shell: ShellKind;
      /**
       * `sendText`'s `shouldExecute` (api-facts.md fact 11). Defaults to `false`: the command is
       * inserted into the terminal but not executed — the user sees the substituted path and
       * presses Enter themselves. `true` is an explicit, per-action opt-in, not a default.
       */
      execute?: boolean;
      /**
      A `render` template, target `{ kind: 'shell'; shell }` — same shell as `command`.
      */
      cwd?: string;
      terminalName?: string;
    }
  | {
      /**
       * Launched directly (no shell), so no shell-metacharacter risk — `command`/`args` are not
       * `render` templates and carry no quoting concern. Still not a safe universal replacement for
       * `terminal`: `.bat`/`.cmd` targets are not executable this way on Windows without a shell
       * (api-facts.md fact 25) — picking `process` for such a target is the action author's
       * mistake, not something this model can catch generically.
       */
      kind: 'process';
      command: string;
      args: readonly string[];
    }
  | {
      kind: 'uri';
      /**
      A `render` template, target `{ kind: 'uri' }`.
      */
      template: string;
    }
  | { kind: 'command'; commandId: string; args?: readonly unknown[] };

/**
 * A named, user-configured action. `id` is what a `Verdict.primaryAction` field-value and rule
 * `then.primaryAction` point at — package 02-B validates that reference against a known set of
 * these ids.
 */
export interface ActionDefinition {
  id: string;
  title?: string;
  /**
  Same `Condition` rules use, compiled with the same `compileCondition` (classification/02-A).
  */
  appliesTo?: Condition;
  spec: ActionSpec;
}

/**
 * Why `render` (render.ts) refused to produce a string. Declared here, not in render.ts or
 * quoting.ts, so both can throw it without importing each other: `quoteForShell` (quoting.ts, cmd's
 * `"` rejection — see quoting.ts) and `render` itself (`unknownVariable`, `missingValue`,
 * `newlineInValue`) both raise it, and render.ts already depends on quoting.ts (render calls the
 * quoting functions) — the reverse edge would make the two files a circular import.
 */
export type RenderErrorReason =
  'unknownVariable' | 'missingValue' | 'newlineInValue' | 'unsafeValue';

export class RenderError extends Error {
  constructor(
    public readonly reason: RenderErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'RenderError';
  }
}
