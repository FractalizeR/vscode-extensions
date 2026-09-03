// Фикстура-нарушитель: ядро не должно импортировать 'vscode' даже type-only импортом — это тот же
// импорт, что реально используется в src/extension.ts, поэтому проверять надо и его.
import type * as vscode from 'vscode';

export function violateBoundary(context: vscode.ExtensionContext): vscode.ExtensionContext {
  return context;
}
