// Контрольный образец: одно-направленная зависимость (без цикла) не должна попадать под правило.
import { d } from './control-d';

export function c(): string {
  return d();
}
