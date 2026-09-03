// Контрольный образец: импорт из легитимного подпредмета (projects/) не должен попадать под
// правило-«последний рубеж».
import { legitimateSubject } from './projects/control';

export function useLegitimateSubject(): string {
  return legitimateSubject();
}
