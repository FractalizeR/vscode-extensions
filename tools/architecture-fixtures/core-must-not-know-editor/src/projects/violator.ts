// Фикстура-нарушитель: ядро не должно знать про адаптер редактора.
import { editorOnlyHelper } from '../editor/foo';

export function violateBoundary(): string {
  return editorOnlyHelper();
}
