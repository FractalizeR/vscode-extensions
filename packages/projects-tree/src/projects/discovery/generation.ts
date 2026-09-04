/**
 * Generation tracking for the core (`docs/plans/projects-tree/02-core.md`, package 02-C).
 *
 * Every traversal is stamped with a generation number when it starts. A traversal superseded by a
 * newer one (e.g. rules changed during a background recheck) must have its result discarded
 * wholly, not merged into the tree partially — mixing nodes from two rule sets produces a tree
 * that never existed under either ruleset. `commit()` is the single point where a finished result
 * is checked against the latest generation and either applied in full or not at all: there is no
 * API for applying a result incrementally, which is what makes partial application structurally
 * unrepresentable rather than merely discouraged.
 */

export interface Generation {
  readonly id: number;
}

export type CommitOutcome<T> =
  { readonly applied: true; readonly result: T } | { readonly applied: false };

export class GenerationTracker {
  #latestId = 0;

  /**
  Starts a new generation, superseding whichever one was latest before this call.
  */
  begin(): Generation {
    this.#latestId += 1;
    return { id: this.#latestId };
  }

  /**
  Whether `generation` is still the latest one, i.e. no newer traversal has started.
  */
  isCurrent(generation: Generation): boolean {
    return generation.id === this.#latestId;
  }

  /**
   * Applies `result` only if `generation` is still current at the time of the call. Build the
   * full result off to the side first and call this once at the end — checking currency earlier
   * and applying incrementally reopens the partial-application hole this type exists to close.
   */
  commit<T>(generation: Generation, result: T): CommitOutcome<T> {
    return this.isCurrent(generation) ? { applied: true, result } : { applied: false };
  }
}
