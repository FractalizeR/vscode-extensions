// Контрольный образец: порт ФС — единственное разрешённое место для node:fs в ядре. Правило
// обязано пропускать именно этот файл (см. pathNot в .dependency-cruiser.mjs); негативная проверка
// требует, чтобы он никогда не попал в список нарушителей — иначе потеря исключения останется
// незамеченной.
import { readdirSync } from 'node:fs';

export function listEntries(path: string): string[] {
  return readdirSync(path);
}
