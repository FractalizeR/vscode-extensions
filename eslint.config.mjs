import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import importX from 'eslint-plugin-import-x';
import security from 'eslint-plugin-security';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/*.vsix',
      '.vscode-test/**',
      'tools/architecture-fixtures/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  unicorn.configs['flat/recommended'],
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'error',
      'security/detect-child-process': 'error',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      // Идентификаторы вроде rootId, RootConfig — предметный язык плана, не сокращения.
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      // Опинионированные переименования (isProd -> isProduction и т.п.) не несут пользы здесь.
      'unicorn/name-replacements': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Плагин путает default/named экспорт в паре CJS/ESM у самих ESLint-плагинов (флаг ложноположительный
      // именно на конфигурационных импортах, не на прикладном коде).
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },
  {
    // tools/**/*.mjs проверяется типизированными правилами наравне с tools/**/*.ts (claude-13):
    // это скрипты тулинга, охраняющие остальные проверки, и они не должны быть наименее
    // проверенным кодом репозитория. tsconfig.json включает их через allowJs/checkJs.
    // tools/**/*.ts уже типизирован по умолчанию — здесь только снимаем no-console, общий для CLI.
    files: ['tools/**/*.mjs', 'tools/**/*.ts'],
    rules: {
      // tools/** — CLI-скрипты тулинга: console — их основной интерфейс с пользователем.
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs'],
    ignores: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    ...tseslint.configs.disableTypeChecked,
  },
  eslintConfigPrettier,
);
