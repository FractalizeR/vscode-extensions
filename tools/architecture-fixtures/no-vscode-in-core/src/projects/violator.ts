// Фикстура-нарушитель: ядро не должно импортировать 'vscode' обычным импортом.
import * as vscode from 'vscode';

export function violateBoundary(): typeof vscode {
  return vscode;
}
