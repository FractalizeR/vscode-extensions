// Фикстура-нарушитель: подпредмет "discovery" обязан импортироваться только через свой index.
import { internalOnly } from '../discovery/internal';

export function violateBoundary(): string {
  return internalOnly();
}
