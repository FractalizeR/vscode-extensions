// Фикстура-нарушитель: подпредмет "actions" обязан импортироваться только через свой index.
import { internalOnly } from '../actions/internal';

export function violateBoundary(): string {
  return internalOnly();
}
