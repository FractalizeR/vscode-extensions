// Фикстура-нарушитель (claude-02): каталог под src/, не являющийся projects/ или editor/, —
// путь отмывки, не покрытый ни одним из остальных правил.
import { stray } from './whatever/x';

export function violateBoundary(): string {
  return stray();
}
