// Фикстура-нарушитель: намеренный цикл violator-a -> violator-b -> violator-a.
import { b } from './violator-b';

export function a(): string {
  return b();
}
