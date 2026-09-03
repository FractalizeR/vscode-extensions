/**
 * Cancellation port for the core (`docs/plans/projects-tree/02-core.md`, package 02-C).
 *
 * The core never imports `vscode` and therefore does not know `CancellationToken`; an editor
 * adapter (stage 03) bridges the editor's token to a `CancellationSource` created here. Consumers
 * (the filesystem walker in 02-D, project list collection in 04-D, the wizard heuristic in 05-C)
 * are expected to call `throwIfCancelled()` between individual filesystem reads, not only once on
 * entry — a traversal must be interruptible mid-flight, not just refuse to start.
 */

export interface CancellationSignal {
  readonly cancelled: boolean;
  throwIfCancelled(): void;
}

export class CancellationError extends Error {
  constructor() {
    super('Operation was cancelled.');
    this.name = 'CancellationError';
  }
}

class Signal implements CancellationSignal {
  constructor(private readonly isCancelled: () => boolean) {}

  get cancelled(): boolean {
    return this.isCancelled();
  }

  throwIfCancelled(): void {
    if (this.isCancelled()) {
      throw new CancellationError();
    }
  }
}

/**
 * Owns the cancellation flag for one traversal. `signal` is handed to the consumer; `cancel()` is
 * called by whoever owns the lifetime decision (the editor adapter, or a test).
 */
export class CancellationSource {
  #cancelledFlag = false;

  readonly signal: CancellationSignal = new Signal(() => this.#cancelledFlag);

  get cancelled(): boolean {
    return this.#cancelledFlag;
  }

  cancel(): void {
    this.#cancelledFlag = true;
  }
}
