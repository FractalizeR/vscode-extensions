import { describe, expect, it, vi } from 'vitest';

interface TestState {
  isTrusted: boolean;
  remoteName: string | undefined;
  warningResponses: (string | undefined)[];
  warningCalls: unknown[][];
}

const state = vi.hoisted((): TestState => ({
  isTrusted: true,
  remoteName: undefined,
  warningResponses: [],
  warningCalls: [],
}));

vi.mock('vscode', () => ({
  workspace: {
    get isTrusted(): boolean {
      return state.isTrusted;
    },
  },
  env: {
    get remoteName(): string | undefined {
      return state.remoteName;
    },
  },
  window: {
    showWarningMessage: (...args: unknown[]) => {
      state.warningCalls.push(args);
      return Promise.resolve(state.warningResponses.shift());
    },
  },
  l10n: {
    t: (message: string, ...args: unknown[]) => {
      let result = message;
      for (const [i, arg] of args.entries()) {
        result = result.split(`{${String(i)}}`).join(String(arg));
      }
      return result;
    },
  },
}));

const { WorkspaceExecutionGate } = await import('./trust.js');

function resetState(): void {
  state.isTrusted = true;
  state.remoteName = undefined;
  state.warningResponses = [];
  state.warningCalls = [];
}

describe('WorkspaceExecutionGate', () => {
  it('never gates openFolder or uri, even in an untrusted workspace', async () => {
    resetState();
    state.isTrusted = false;
    const gate = new WorkspaceExecutionGate();

    expect(await gate.check('openFolder')).toEqual({ allowed: true });
    expect(await gate.check('uri')).toEqual({ allowed: true });
  });

  it('refuses terminal, process, and command in an untrusted workspace, with an explanation', async () => {
    resetState();
    state.isTrusted = false;
    const gate = new WorkspaceExecutionGate();

    for (const kind of ['terminal', 'process', 'command'] as const) {
      const decision = await gate.check(kind);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.message.length).toBeGreaterThan(0);
    }
  });

  it('allows a gated kind in a trusted, non-remote workspace without prompting', async () => {
    resetState();
    const gate = new WorkspaceExecutionGate();

    expect(await gate.check('terminal')).toEqual({ allowed: true });
    expect(state.warningCalls).toHaveLength(0);
  });

  it('prompts once per remote authority, naming the remote, and allows on confirmation', async () => {
    resetState();
    state.remoteName = 'ssh-remote';
    state.warningResponses = ['Allow'];
    const gate = new WorkspaceExecutionGate();

    const decision = await gate.check('terminal');

    expect(decision).toEqual({ allowed: true });
    expect(state.warningCalls).toHaveLength(1);
    expect(String(state.warningCalls[0]?.[0])).toContain('ssh-remote');
  });

  it('does not prompt again for the same remote after it was accepted', async () => {
    resetState();
    state.remoteName = 'ssh-remote';
    state.warningResponses = ['Allow'];
    const gate = new WorkspaceExecutionGate();

    await gate.check('terminal');
    const second = await gate.check('process');

    expect(second).toEqual({ allowed: true });
    expect(state.warningCalls).toHaveLength(1);
  });

  it("a new gate instance re-prompts instead of inheriting an earlier instance's consent", async () => {
    // R07-REMOTE-AUTHORITY: consent must not survive past the gate instance that granted it.
    // `remoteName` is a transport class ('ssh-remote', 'wsl' — fact 72's own quote names these as
    // samples), not a specific host: two different SSH servers report the identical remoteName, so
    // a gate that remembered "ssh-remote -> allowed" across instances (sessions/windows) would
    // silently extend one server's consent to every other SSH server ever connected to. A fresh
    // gate instance — modeling a new window or a reload, possibly against a different real host —
    // must ask again rather than trust a persisted decision keyed on the transport class alone.
    resetState();
    state.remoteName = 'ssh-remote';
    state.warningResponses = ['Allow'];
    const first = new WorkspaceExecutionGate();
    await first.check('terminal');

    state.warningResponses = ['Allow'];
    const second = new WorkspaceExecutionGate();
    const decision = await second.check('command');

    expect(decision).toEqual({ allowed: true });
    expect(state.warningCalls).toHaveLength(2);
  });

  it('refuses and remembers a decline for the session without re-prompting', async () => {
    resetState();
    state.remoteName = 'ssh-remote';
    state.warningResponses = [undefined];
    const gate = new WorkspaceExecutionGate();

    const first = await gate.check('terminal');
    expect(first.allowed).toBe(false);
    if (!first.allowed) expect(first.message).toContain('ssh-remote');

    const second = await gate.check('process');
    expect(second.allowed).toBe(false);
    expect(state.warningCalls).toHaveLength(1);
  });
});
