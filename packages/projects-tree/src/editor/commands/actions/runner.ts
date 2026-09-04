import * as vscode from 'vscode';
import {
  RenderError,
  type ActionDefinition,
  type ActionRenderNode,
  type ActionSpec,
} from '../../../projects/actions/index.js';
// The canonical structural declaration of the gate lives in `configuration/trust.ts` (package
// 04-B), not here: the two used to be independent, identically-shaped copies (one per side of the
// seam), which typechecked only because they happened to stay in sync — a silent trap the moment
// one side gained a member the other lacked. `commands/` already depends on `configuration/`
// elsewhere (`roots.ts`), so importing the type here is the existing dependency direction, not a
// new edge; the reverse (`configuration/` importing this file) would risk `no-circular`.
import type { ExecutionGate } from '../../configuration/index.js';
import { runOpenFolder } from './open-folder.js';
import type { ActionRegistry } from './registry.js';
import { runProcess } from './process.js';
import { runTerminal } from './terminal.js';
import { runUri } from './uri.js';
import { runVscodeCommand } from './vscode-command.js';

export type { ExecutionDecision, ExecutionGate } from '../../configuration/index.js';

export interface ActionRunner {
  run(action: ActionDefinition, node: ActionRenderNode): Promise<void>;
}

/**
 * `terminal`, `process` and `command` reach a shell, a spawned process, or an arbitrary editor
 * command respectively — the three sinks the threat model (00-overview.md, "Модель угроз") treats
 * as executing, as opposed to merely opening something. `openFolder` and `uri` are not gated: the
 * platform itself is the checkpoint for those (`vscode.openFolder` only ever opens a directory as a
 * workspace; `env.openExternal`, api-facts.md fact 63, is the OS's own external-open path).
 */
const GATED_KINDS: ReadonlySet<ActionSpec['kind']> = new Set(['terminal', 'process', 'command']);

/**
 * Builds the single dispatcher every action kind runs through. `RenderError` (thrown by any
 * executor's `render`/`renderArgs`/`renderCommandArgs` call — projects/actions/render.ts) is caught
 * here, once, for every kind, rather than duplicated per executor: "any `RenderError` becomes a
 * user-facing message, the action does not run" (04-actions.md) is a property of running an action,
 * not of any one sink.
 */
export function createActionRunner(gate: ExecutionGate): ActionRunner {
  return {
    async run(action, node) {
      const { spec } = action;
      if (GATED_KINDS.has(spec.kind)) {
        const decision = await gate.check(spec.kind);
        if (!decision.allowed) {
          void vscode.window.showErrorMessage(decision.message);
          return;
        }
      }
      try {
        await dispatch(spec, node);
      } catch (error) {
        if (error instanceof RenderError) {
          void vscode.window.showErrorMessage(localizedRenderErrorMessage(error));
          return;
        }
        throw error;
      }
    },
  };
}

/**
 * `RenderError.message` (`projects/actions/render.ts`) is an English diagnostic built inside the
 * `vscode`-free core — it must not reach `showErrorMessage` as-is (R07-L10N-BYPASS): that would put
 * a hardcoded English string in front of the user, invisible to `l10n:check` since it never goes
 * through `vscode.l10n.t()`. `reason` is the structured, locale-neutral signal `RenderErrorReason`
 * exists for (`action.ts`'s own doc comment on `RenderErrorReason`) — one localized sentence per
 * reason, not a translation of the English detail text, which can differ per call site (`quoting.ts`
 * throws two different `unsafeValue` messages for `cmd`, for instance) without changing which
 * high-level thing went wrong.
 */
function localizedRenderErrorMessage(error: RenderError): string {
  switch (error.reason) {
    case 'unknownVariable': {
      return vscode.l10n.t('This action could not run: its template uses an unknown variable.');
    }
    case 'missingValue': {
      return vscode.l10n.t(
        'This action could not run: its template needs a value that is not available right now.',
      );
    }
    case 'controlCharacterInValue': {
      return vscode.l10n.t(
        'This action could not run: a substituted value contains a character that is never allowed.',
      );
    }
    case 'unsafeValue': {
      return vscode.l10n.t(
        'This action could not run: a substituted value cannot be safely quoted for its shell.',
      );
    }
  }
}

async function dispatch(spec: ActionSpec, node: ActionRenderNode): Promise<void> {
  switch (spec.kind) {
    case 'openFolder': {
      return runOpenFolder(spec, node);
    }
    case 'terminal': {
      runTerminal(spec, node);
      return;
    }
    case 'process': {
      return runProcess(spec, node);
    }
    case 'uri': {
      return runUri(spec, node);
    }
    case 'command': {
      return runVscodeCommand(spec, node);
    }
  }
}

/**
 * Resolves `id` through `registry` before running it — the one place a `primaryAction`/keybinding
 * argument that no longer resolves (the rules file changed since; a keybinding was authored against
 * an action later removed) is handled, rather than pushed onto every call site. `ActionRunner.run`
 * itself takes an already-resolved `ActionDefinition`, matching `docs/plans/projects-tree/
 * 04-actions.md`'s own `ActionRunner` interface — validation upstream (classification's
 * `validateRules`, package 02-B) keeps this from happening for anything the rules file itself
 * declares, but a caller resolving an id at a different point in time (a keybinding argument,
 * `defaultAction`) is not covered by that validation.
 */
export async function runActionById(
  registry: ActionRegistry,
  runner: ActionRunner,
  id: string,
  node: ActionRenderNode,
): Promise<void> {
  const action = registry.byId(id);
  if (action === undefined) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Action "{0}" is not defined.', id));
    return;
  }
  await runner.run(action, node);
}
