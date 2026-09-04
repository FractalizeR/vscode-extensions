// Контрольный образец: webview-логика без vscode и без кода расширения не должна попадать под
// правило, и относительный импорт внутри собственного webview/src/ не должен ловиться матчером,
// исключающим "webview/" перед "src/".
import { helper } from './helper';

export function render(): string {
  return helper();
}
