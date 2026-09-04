// Фикстура-нарушитель (codex-04): webview не должен импортировать точку входа расширения
// напрямую — правило обязано запрещать весь src/ пакета, а не только src/projects и src/editor.
import { activate } from '../../src/extension';

export function violateBoundary(): void {
  activate();
}
