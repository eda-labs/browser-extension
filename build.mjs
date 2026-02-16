import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const targets = [];
if (process.argv.includes('--firefox')) targets.push('firefox');
if (process.argv.includes('--chromium')) targets.push('chromium');

if (!targets.length) {
  console.error('Usage: node build.mjs --firefox | --chromium | --firefox --chromium');
  process.exit(1);
}

const bgOpts = {
  entryPoints: ['src/background.ts', 'src/content.ts'],
  bundle: true, format: 'iife', target: 'es2020',
};

const popupOpts = {
  entryPoints: ['src/popup.tsx'],
  bundle: true, format: 'iife', target: 'es2020',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'file', '.woff2': 'file' },
  assetNames: 'fonts/[name]',
};

for (const target of targets) {
  const outdir = 'dist/' + target;
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  cpSync('static/', outdir + '/', { recursive: true });

  if (target === 'chromium') {
    const manifest = JSON.parse(readFileSync(outdir + '/manifest.json', 'utf-8'));
    manifest.background = { service_worker: 'background.js' };
    delete manifest.browser_specific_settings;
    writeFileSync(outdir + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  }

  await build({ ...bgOpts, outdir });
  await build({ ...popupOpts, outdir });
}
