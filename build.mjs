import { build, context } from 'esbuild';
import { cpSync, rmSync, mkdirSync } from 'fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

const bgOpts = {
  entryPoints: ['src/background.ts', 'src/content.ts'],
  bundle: true, outdir: 'dist', format: 'iife', target: 'es2020',
};

const popupOpts = {
  entryPoints: ['src/popup.tsx'],
  bundle: true, outdir: 'dist', format: 'iife', target: 'es2020',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'file', '.woff2': 'file' },
  assetNames: 'fonts/[name]',
};

cpSync('static/', 'dist/', { recursive: true });

if (watch) {
  const bgCtx = await context(bgOpts);
  const popupCtx = await context(popupOpts);
  await bgCtx.watch();
  await popupCtx.watch();
  console.log('Watching for changes...');
} else {
  await build(bgOpts);
  await build(popupOpts);
}
