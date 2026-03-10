import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function parseEnvText(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIdx = value.indexOf(' #');
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    }
    out[key] = value;
  }
  return out;
}

async function loadEnvFile(envFilePath) {
  let content;
  try {
    content = await fs.readFile(envFilePath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Missing env file: ${envFilePath}`, { cause: err });
    }
    throw err;
  }

  const parsed = parseEnvText(content);
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function ensureBuildExists(extensionDir) {
  await fs.access(extensionDir).catch(() => {
    throw new Error(`Missing build output at ${extensionDir}. Run: pnpm run build:chromium`);
  });
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 15_000 }).catch(() => null);
  }

  if (!worker) {
    throw new Error(
      'Chromium did not register the extension service worker. The extension was not loaded.',
    );
  }

  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (!match) {
    throw new Error(`Could not detect extension ID from service worker URL: ${worker.url()}`);
  }

  return match[1];
}

function formatLaunchError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('channel') && message.includes('chrome')) {
    return 'Chromium could not be launched. Make sure Playwright has a Chromium browser available.';
  }
  return message;
}

function normalizeEdaUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new Error('EDA_URL is required');

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withScheme);
  return `${url.protocol}//${url.host}`;
}

function getRequired(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function main() {
  const envFile = path.resolve(process.cwd(), process.env.EDA_ENV_FILE || '.env');
  await loadEnvFile(envFile);

  const extensionDir = path.resolve(process.cwd(), 'dist/chromium');
  await ensureBuildExists(extensionDir);

  const edaUrl = normalizeEdaUrl(getRequired('EDA_URL'));
  const openUrl = process.env.EDA_OPEN_URL || edaUrl;

  const profileDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'eda-browser-extension-chrome-'),
  );

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: false,
      viewport: null,
      args: [
        '--start-maximized',
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    });

    const extensionId = await getExtensionId(context);
    const appPage = context.pages()[0] ?? await context.newPage();
    await appPage.goto(openUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    });

    const stopPromise = new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    const closePromise = new Promise((resolve) => {
      context.once('close', resolve);
    });

    console.log(`Loaded extension ${extensionId}`);
    console.log(`EDA URL: ${edaUrl}`);
    console.log(`Opened: ${openUrl}`);
    console.log('Chromium is running. Press Ctrl+C to exit.');
    await Promise.race([closePromise, stopPromise]);
  } catch (err) {
    throw new Error(formatLaunchError(err), { cause: err });
  } finally {
    await context?.close().catch(() => {});
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed to launch Chromium with extension: ${message}`);
  process.exit(1);
}
