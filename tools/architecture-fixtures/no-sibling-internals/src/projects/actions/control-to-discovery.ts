// Контрольный образец: импорт через index соседнего подпредмета — разрешённый путь, правило не
// должно на нём срабатывать.
import { internalOnly } from '../discovery';

export function useViaIndex(): string {
  return internalOnly();
}
