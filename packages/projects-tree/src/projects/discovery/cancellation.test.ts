import { describe, expect, it } from 'vitest';
import { CancellationError, CancellationSource } from './cancellation.js';

describe('CancellationSignal', () => {
  it('starts uncancelled and throwIfCancelled is a no-op', () => {
    const source = new CancellationSource();

    expect(source.signal.cancelled).toBe(false);
    expect(() => {
      source.signal.throwIfCancelled();
    }).not.toThrow();
  });

  it('reflects cancel() on the live source, not a snapshot taken when the signal was read', () => {
    const source = new CancellationSource();
    const signal = source.signal; // read before cancel() — must still see the later state

    source.cancel();

    expect(signal.cancelled).toBe(true);
    expect(() => {
      signal.throwIfCancelled();
    }).toThrow(CancellationError);
  });
});

/**
 * Models the DoD requirement "a cancelled traversal stops reading the filesystem" without the
 * real walker (02-D): a fake consumer that reads directories one at a time and checks the signal
 * before each read, counting how many reads it actually performed.
 */
function fakeTraversal(
  signal: { throwIfCancelled(): void },
  dirCount: number,
  onRead: (readsSoFar: number) => void,
): void {
  for (let i = 0; i < dirCount; i += 1) {
    signal.throwIfCancelled();
    onRead(i);
  }
}

describe('cancellation checked between reads, not only on entry', () => {
  it('stops reading further directories once cancelled mid-traversal', () => {
    const source = new CancellationSource();
    let readCount = 0;

    expect(() => {
      fakeTraversal(source.signal, /* dirCount */ 5, (readsSoFar) => {
        readCount += 1;
        if (readsSoFar === 1) {
          // Cancellation arrives mid-traversal — the editor adapter cancels while the walker is
          // still between two directory reads, not before the walker started at all.
          source.cancel();
        }
      });
    }).toThrow(CancellationError);

    // Reads 0 and 1 happened before cancellation; the check before read 2 must stop it — a
    // single check on entry to the whole traversal could never produce this count.
    expect(readCount).toBe(2);
  });

  it('a traversal that finishes before cancellation reads everything', () => {
    const source = new CancellationSource();
    let readCount = 0;

    fakeTraversal(source.signal, 3, () => {
      readCount += 1;
    });

    expect(readCount).toBe(3);
  });
});
