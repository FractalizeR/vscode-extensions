import { describe, expect, it } from 'vitest';

// Заглушка, чтобы `vitest run` не падал на «нет тестов» до появления ядра (этап 02).
describe('tooling smoke test', () => {
  it('runs under vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
