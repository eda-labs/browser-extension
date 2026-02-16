import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const target = process.argv.includes('--chromium') ? 'chromium' : 'firefox';

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

if (target === 'chromium') {
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf-8'));
  manifest.background = { service_worker: 'background.js' };
  delete manifest.browser_specific_settings;
  writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}

await build(bgOpts);
await build(popupOpts);
