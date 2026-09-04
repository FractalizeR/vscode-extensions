/**
 * The execution gate (`docs/plans/projects-tree/04-actions.md`, package 04-B; threat model in
 * `00-overview.md`). Two unrelated distrust sources feed one decision:
 *
 * - workspace trust (`vscode.workspace.isTrusted`, api-facts.md fact 70) — the workspace itself may
 *   contain an untrusted `.vscode/settings.json`;
 * - a remote extension host (`vscode.env.remoteName`, fact 72) — `scope: machine` settings
 *   (`roots`, `maxDepth`, `defaultAction`) come from user-or-remote settings (fact 18), so in a
 *   remote window they may have been written by whoever controls the remote machine, not by this
 *   user.
 *
 * `openFolder` and `uri` are never gated: neither runs an arbitrary command or shell. `terminal`
 * and `process` are the sinks the threat model names directly; `command` is gated too — a decision
 * this package made explicitly (04-B task text): it invokes an arbitrary VS Code command, which is
 * execution just as much as a shell or a spawned process.
 *
 * R07-REMOTE-AUTHORITY: `remoteName` is a *transport class* (`ssh-remote`, `wsl` — fact 72's own
 * quote names these as "popular samples"), not a specific host. A consent keyed on it would be
 * granted once against one SSH server and silently apply to every other SSH server the same window
 * (or a later one) ever connects to. 1.85's public API has no cited fact establishing a reliable
 * per-host identity (`Uri.authority` is generic Uri-component doc, with no remote-specific
 * semantics; `workspace.workspaceFolders[].uri` carries the same undocumented-format authority for
 * a remote scheme) — so this gate does not persist consent across sessions at all. Both an
 * acceptance and a decline live only in this gate instance's own memory, for the lifetime of the
 * extension host session that created it: re-prompting once per window is the honest cost of having
 * no trustworthy key to remember consent by.
 */
import * as vscode from 'vscode';
import type { ActionSpec } from '../../projects/actions/index.js';

export type ExecutionDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly message: string };

/**
 * The single structural declaration of the gate `commands/actions/runner.ts` (package 04-A) runs
 * every gated action through — that file imports this type rather than redeclaring it, so the two
 * sides of the seam cannot drift apart the way an independent structural copy on each side could.
 * `configuration/` is the canonical owner: `commands/` already depends on `configuration/`
 * elsewhere (`add-root.ts`'s `readRoots` import), so this is the existing dependency direction, not
 * a new one, and the reverse edge (`configuration/` importing from `commands/`) would risk
 * `no-circular` the moment `commands/` needs anything back from here.
 *
 * `check` is the gate's only entry point, called exactly once per gated action, at the moment it is
 * about to run (`commands/actions/runner.ts`'s `createActionRunner`) — never earlier. An earlier
 * revision also exposed a non-prompting variant, read on every tree refresh (including activation)
 * to drive a `when`-clause context key that hid the executing menu items in an untrusted or
 * undecided-remote window. Both are gone: 04-B's DoD requires that an executing action stay
 * *visible* and explain itself on click rather than disappear — hiding the menu item would have made
 * the one prompt that could ever turn the non-prompting variant's "not yet allowed" answer into
 * "allowed" unreachable from a remote window (the deadlock `manifest-contract.test.ts` used to lock
 * against). With nothing left to hide, the non-prompting variant had no remaining caller and was
 * removed rather than kept "for later" — a computation with no observable effect is the same defect
 * class this project has already found twice (round 06 review, decoration signal without
 * propagation).
 */
export interface ExecutionGate {
  check(kind: ActionSpec['kind']): Promise<ExecutionDecision>;
}

const GATED_KINDS: ReadonlySet<ActionSpec['kind']> = new Set(['terminal', 'process', 'command']);

function untrustedDecision(): ExecutionDecision {
  return {
    allowed: false,
    message: vscode.l10n.t(
      'This workspace is not trusted. Enable Workspace Trust to run terminal, external process, or VS Code command actions.',
    ),
  };
}

/**
 * Neither decision is persisted to `globalState` (see this module's doc comment,
 * R07-REMOTE-AUTHORITY): `remoteName` names a transport class, not a host, so there is no key here
 * that would not conflate two different remote machines of the same kind. Both `#acceptedRemotes`
 * and `#declinedRemotes` are plain in-memory sets, scoped to this gate instance — i.e. to one
 * extension host session. A reload, or a new window connecting to the same or a different remote,
 * asks again exactly once, regardless of what an earlier session decided.
 */
export class WorkspaceExecutionGate implements ExecutionGate {
  static #declinedMessage(remoteName: string): string {
    return vscode.l10n.t(
      'Execution on remote "{0}" was declined. projectsTree.roots and the default action come from that machine\'s settings, not yours.',
      remoteName,
    );
  }

  /**
  Modal, not a toast: this is a one-time trust decision, not an informational message, and a toast
  the user can dismiss without answering would leave `#declinedRemotes` unset — every subsequent
  action would ask again, defeating "not asked every click".
  */
  static async #confirmRemote(remoteName: string): Promise<boolean> {
    const allow = vscode.l10n.t('Allow');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'This window is connected to remote "{0}". projectsTree.roots and the default action come from that machine\'s settings, not yours — allow running terminal, external process, or VS Code command actions here?',
        remoteName,
      ),
      { modal: true },
      allow,
    );
    return choice === allow;
  }

  readonly #acceptedRemotes = new Set<string>();
  readonly #declinedRemotes = new Set<string>();

  async check(kind: ActionSpec['kind']): Promise<ExecutionDecision> {
    if (!GATED_KINDS.has(kind)) return { allowed: true };
    if (!vscode.workspace.isTrusted) return untrustedDecision();

    const remoteName = vscode.env.remoteName;
    if (remoteName === undefined) return { allowed: true };

    if (this.#acceptedRemotes.has(remoteName)) {
      return { allowed: true };
    }

    if (this.#declinedRemotes.has(remoteName)) {
      return { allowed: false, message: WorkspaceExecutionGate.#declinedMessage(remoteName) };
    }

    const isAllowed = await WorkspaceExecutionGate.#confirmRemote(remoteName);
    if (!isAllowed) {
      this.#declinedRemotes.add(remoteName);
      return { allowed: false, message: WorkspaceExecutionGate.#declinedMessage(remoteName) };
    }

    this.#acceptedRemotes.add(remoteName);
    return { allowed: true };
  }
}

/**
 * `context` is accepted but unused: `extension.ts` (owned by a parallel package of this same
 * review round) wires this up as `createWorkspaceTrustExecutionGate(context)`, and changing the
 * call site is out of scope here. `WorkspaceExecutionGate` no longer persists anything to
 * `globalState` (R07-REMOTE-AUTHORITY) — keeping the parameter, unused, is cheaper than touching a
 * file this change must not edit.
 */
export function createWorkspaceTrustExecutionGate(
  _context: Pick<vscode.ExtensionContext, 'globalState'>,
): ExecutionGate {
  return new WorkspaceExecutionGate();
}
