import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
const manifestVersion = String(packageJson.version).split('-')[0];
if (!/^\d+\.\d+\.\d+$/.test(manifestVersion)) {
  console.error(`Invalid package.json version "${packageJson.version}". Expected x.y.z.`);
  process.exit(1);
}

const targets = [];
if (process.argv.includes('--firefox')) targets.push('firefox');
if (process.argv.includes('--chromium')) targets.push('chromium');

if (!targets.length) {
  console.error('Usage: node build.mjs --firefox | --chromium | --firefox --chromium');
  process.exit(1);
}

const bgOpts = {
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/omnisearch-page.ts'],
  bundle: true, format: 'iife', target: 'es2020',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
};

const uiOpts = {
  entryPoints: ['src/popup.tsx', 'src/settings.tsx'],
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

  const manifest = JSON.parse(readFileSync(outdir + '/manifest.json', 'utf-8'));
  manifest.version = manifestVersion;

  if (target === 'chromium') {
    manifest.background = { service_worker: 'background.js' };
    delete manifest.browser_specific_settings;
  }
  writeFileSync(outdir + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');

  await build({ ...bgOpts, outdir });
  await build({ ...uiOpts, outdir });
}
