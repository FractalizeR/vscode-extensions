import { build } from 'esbuild';

const isProd = process.argv.includes('--prod');

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  // Рантайм — Node самого редактора (нижняя граница engines.vscode = 1.85 → Node 18),
  // не Node 26 из корневого engines.node, который относится к тулингу.
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  // Prod: external map on disk for post-mortem debugging of the shipped bundle,
  // kept out of the .vsix by .vscodeignore (**/*.map). Dev: inline for fast iteration.
  sourcemap: isProd ? 'external' : true,
  minify: isProd,
  logLevel: 'info',
});
