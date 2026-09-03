// Вся таблица docs/plans/projects-tree/api-facts.md опирается на одно допущение: типы, против которых
// компилируется расширение, — это типы нижней границы `engines.vscode`, а не более свежие. Если
// @types/vscode уедет вперёд, компилятор начнёт пропускать API, которого на планке нет, и расширение
// сломается у пользователя, а не в CI. Ровно этот класс ошибки уже случился внутри самой таблицы:
// факт 43 объявил `ThemeColor.id` доступным на 1.85, где класс объявляет только конструктор.
//
// Здесь сверяются два независимых места манифеста расширения: `engines.vscode` (что мы обещаем
// поддерживать) и точная версия devDependency `@types/vscode` (против чего компилируем). Расхождение
// означает, что обещание больше ничем не проверяется.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../packages/projects-tree/package.json', import.meta.url);
const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as {
  engines: { vscode: string };
  devDependencies: Record<string, string>;
};

describe('VS Code compatibility floor', () => {
  it('compiles against exactly the types of the floor it promises', () => {
    const floor = manifest.engines.vscode;
    const types = manifest.devDependencies['@types/vscode'];
    // `engines.vscode` is a range (`^1.85.0`); the types must be pinned to that range's floor
    // exactly, with no `^`/`~` — a caret there would let a newer minor in on the next install and
    // raise the effective API surface without anyone deciding to.
    expect(floor).toMatch(/^\^\d+\.\d+\.\d+$/);
    expect(types).toBe(floor.replace('^', ''));
  });

  it('has one resolved @types/vscode, at the floor', () => {
    const lockUrl = new URL('../pnpm-lock.yaml', import.meta.url);
    const lock = readFileSync(fileURLToPath(lockUrl), 'utf8');
    const resolved = new Set(
      Array.from(lock.matchAll(/^ {2}'@types\/vscode@([^']+)':/gm), (match) => match[1]),
    );
    expect([...resolved]).toEqual([manifest.devDependencies['@types/vscode']]);
  });
});
