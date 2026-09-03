// AGENTS.md перечисляет шаги `pnpm check` по порядку и требует, чтобы добавивший проверку дописал её
// в этот список. Правило уже однажды нарушили молча: `schema:check` попал в цепочку, а в список — нет,
// и рассинхронизация прожила до этапа 03. Обещание канона ничем не проверялось, поэтому и разошлось.
//
// Тест сверяет два независимых источника — нумерованный список в AGENTS.md и фактическую цепочку
// в scripts.check корневого package.json — и падает при любом расхождении в составе или порядке.
// Именно два источника, а не один: если бы список генерировался из package.json, он совпадал бы
// всегда и проверял сам себя (та же болезнь, что описана в tools/depcruise-negative.ts, инвариант 3).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function documentedSteps(): string[] {
  const agents = readFileSync(`${repoRoot}AGENTS.md`, 'utf8');
  const validation = agents.slice(
    agents.indexOf('## Validation'),
    agents.indexOf('The package that introduces a new class of check'),
  );
  // Нумерованный пункт вида "8. `l10n:check` — ...". Продолжения пункта на следующей строке (отступ
  // без номера) намеренно не матчатся: имя шага берётся только из первой строки.
  return Array.from(validation.matchAll(/^\d+\.\s+`([^`]+)`/gm), (match) => match[1] ?? '');
}

function actualSteps(): string[] {
  const manifest = readFileSync(`${repoRoot}package.json`, 'utf8');
  const { scripts } = JSON.parse(manifest) as { scripts: Record<string, string> };
  const chain = scripts.check ?? '';
  return Array.from(chain.matchAll(/pnpm run ([\w:-]+)/g), (match) => match[1] ?? '');
}

describe('pnpm check chain', () => {
  it('is documented in AGENTS.md in the same order it runs', () => {
    expect(documentedSteps()).toEqual(actualSteps());
  });

  it('parses both sources non-trivially', () => {
    // Без этого обе выборки могли бы оказаться пустыми и совпасть: сломанный парсер выглядел бы как
    // зелёная проверка — ровно тот отказ, против которого написан весь этот файл.
    expect(actualSteps().length).toBeGreaterThan(5);
    expect(documentedSteps()).toContain('format:check');
  });
});
