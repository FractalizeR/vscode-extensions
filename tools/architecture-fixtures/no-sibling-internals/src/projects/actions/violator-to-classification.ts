// Фикстура-нарушитель: подпредмет "classification" обязан импортироваться только через свой index.
import { internalOnly } from '../classification/internal';

export function violateBoundary(): string {
  return internalOnly();
}
