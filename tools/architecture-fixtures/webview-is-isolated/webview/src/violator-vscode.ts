// Фикстура-нарушитель: webview не должен импортировать 'vscode' (это API расширения, не браузера).
import * as vscode from 'vscode';

export function violateBoundary(): typeof vscode {
  return vscode;
}
