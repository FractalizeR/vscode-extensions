// Фикстура-нарушитель: node:fs вне порта ФС протекает границу "ядро тестируемо на фейковой ФС".
import { readdirSync } from 'node:fs';

export function violateBoundary(path: string): string[] {
  return readdirSync(path);
}
