import { describe, expect, it } from 'vitest';
import { GenerationTracker } from './generation.js';

describe('GenerationTracker.begin/isCurrent', () => {
  it('each begin() is a new, strictly later generation', () => {
    const tracker = new GenerationTracker();

    const first = tracker.begin();
    const second = tracker.begin();

    expect(second.id).toBeGreaterThan(first.id);
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });
});

describe('GenerationTracker.commit — stale results are discarded wholly', () => {
  /**
   * Regression: a superseded traversal that produced a partial-looking result (fewer nodes than
   * a full walk would have) must contribute nothing at all, not "fewer nodes than expected". A
   * bug that applies stale results whenever they happen to be non-empty would pass a test that
   * only checks "result is smaller", so this asserts the applied set is exactly empty.
   */
  it('a superseded generation applies nothing, even a non-empty partial result', () => {
    const tracker = new GenerationTracker();
    const applied: string[] = [];

    const genA = tracker.begin();
    // Generation A started walking and produced some nodes before being superseded.
    const partialResultFromA = ['nodeA1', 'nodeA2', 'nodeA3'];

    // A newer traversal starts mid-flight (e.g. rules changed), superseding A.
    const genB = tracker.begin();

    const outcomeA = tracker.commit(genA, partialResultFromA);
    if (outcomeA.applied) {
      applied.push(...outcomeA.result);
    }

    expect(outcomeA.applied).toBe(false);
    expect(applied).toEqual([]); // nothing at all — not "fewer than three"

    const fullResultFromB = ['nodeB1', 'nodeB2'];
    const outcomeB = tracker.commit(genB, fullResultFromB);
    if (outcomeB.applied) {
      applied.push(...outcomeB.result);
    }

    expect(outcomeB.applied).toBe(true);
    expect(applied).toEqual(['nodeB1', 'nodeB2']);
  });

  it('a generation that finishes before being superseded commits normally', () => {
    const tracker = new GenerationTracker();
    const generation = tracker.begin();

    const outcome = tracker.commit(generation, ['solo-node']);

    expect(outcome).toEqual({ applied: true, result: ['solo-node'] });
  });
});
