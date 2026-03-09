import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
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
      throw new Error(`Missing env file: ${envFilePath}`);
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

async function ensureDirExists(dirPath, reset) {
  if (reset) {
    await fs.rm(dirPath, { recursive: true, force: true });
  }
  await fs.mkdir(dirPath, { recursive: true });
}

async function getExtensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 45_000 });
  }
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)\//);
  if (!match) {
    throw new Error(`Could not detect extension ID from service worker URL: ${worker.url()}`);
  }
  return match[1];
}

async function clickIfVisible(locator) {
  const visible = await locator.isVisible().catch(() => false);
  if (visible) {
    await locator.click();
    return true;
  }
  return false;
}

async function maybeDirectUiLogin(page, cfg) {
  if (!cfg.enabled) return false;

  const username = page.locator('#username, input[name="username"], input[type="email"]').first();
  const password = page.locator('#password, input[name="password"]').first();
  const submit = page.locator('#kc-login, button[type="submit"], input[type="submit"]').first();

  const userVisible = await username.isVisible().catch(() => false);
  const passVisible = await password.isVisible().catch(() => false);
  if (!userVisible || !passVisible) return false;

  await username.fill(cfg.username);
  await password.fill(cfg.password);

  if (await submit.isVisible().catch(() => false)) {
    await Promise.allSettled([
      page.waitForLoadState('domcontentloaded', { timeout: 20_000 }),
      submit.click(),
    ]);
  } else {
    await Promise.allSettled([
      page.waitForLoadState('domcontentloaded', { timeout: 20_000 }),
      password.press('Enter'),
    ]);
  }
  return true;
}

async function configurePopup(page, cfg) {
  const connectBtn = page.getByRole('button', { name: 'Connect' });
  const disconnectBtn = page.getByRole('button', { name: 'Disconnect' });

  if (await disconnectBtn.isVisible().catch(() => false)) {
    await disconnectBtn.click();
    await connectBtn.waitFor({ state: 'visible', timeout: 15_000 });
  }

  const edaHost = new URL(cfg.edaUrl).host;
  await page.getByLabel('EDA URL').fill(edaHost);
  await page.getByLabel('Username').first().fill(cfg.edaUsername);
  await page.getByLabel('Password').first().fill(cfg.edaPassword);

  const autoLoginCheckbox = page.getByRole('checkbox').first();
  const isAutoLoginChecked = await autoLoginCheckbox.isChecked();
  if (cfg.autoLogin !== isAutoLoginChecked) {
    await autoLoginCheckbox.click();
    if (cfg.autoLogin) {
      await page.getByRole('button', { name: 'Enable' }).click();
    }
  }

  if (cfg.clientSecret) {
    await page.getByLabel('Client Secret').fill(cfg.clientSecret);
  } else {
    await page.getByRole('button', { name: 'Fetch' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Get Client Secret' });
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    await dialog.getByLabel('Username').fill(cfg.kcUsername);
    await dialog.getByLabel('Password').fill(cfg.kcPassword);
    await dialog.getByRole('button', { name: 'Fetch' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 30_000 });

    const secretValue = await page.getByLabel('Client Secret').inputValue();
    if (!secretValue) {
      throw new Error('Failed to fetch client secret; set EDA_CLIENT_SECRET explicitly');
    }
  }

  if (cfg.connect) {
    await connectBtn.click();
    await disconnectBtn.waitFor({ state: 'visible', timeout: 45_000 });
  } else {
    const saveIcon = page.getByRole('button', { name: 'Save' });
    await clickIfVisible(saveIcon);
  }
}

async function waitUntilExit() {
  await new Promise((resolve) => {
    const finish = () => resolve();
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

async function main() {
  const envFile = path.resolve(process.cwd(), process.env.EDA_ENV_FILE || '.env');
  await loadEnvFile(envFile);

  const edaUrl = normalizeEdaUrl(getRequired('EDA_URL'));
  const edaUsername = getRequired('EDA_USERNAME');
  const edaPassword = getRequired('EDA_PASSWORD');
  const clientSecret = process.env.EDA_CLIENT_SECRET || '';
  const kcUsername = process.env.EDA_KC_USERNAME || edaUsername;
  const kcPassword = process.env.EDA_KC_PASSWORD || edaPassword;

  const connect = parseBoolean(process.env.EDA_CONNECT, true);
  const autoLogin = parseBoolean(process.env.EDA_AUTO_LOGIN, true);
  const directLoginFallback = parseBoolean(process.env.EDA_DIRECT_LOGIN_FALLBACK, true);
  const requestedHeadless = parseBoolean(process.env.EDA_HEADLESS, false);
  if (requestedHeadless) {
    console.warn('EDA_HEADLESS=true requested, but Chromium extensions require headed mode. Launching headed.');
  }
  const headless = false;
  const resetProfile = parseBoolean(process.env.EDA_RESET_PROFILE, true);
  const keepOpen = parseBoolean(process.env.EDA_KEEP_OPEN, !headless);
  const profileDir = path.resolve(
    process.cwd(),
    process.env.EDA_PROFILE_DIR || '/tmp/eda-browser-extension-profile',
  );
  const openUrl = process.env.EDA_OPEN_URL || edaUrl;
  const extensionDir = path.resolve(process.cwd(), 'dist/chromium');

  await fs.access(extensionDir).catch(() => {
    throw new Error(`Missing build output at ${extensionDir}. Run: npm run build:chromium`);
  });
  await ensureDirExists(profileDir, resetProfile);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    ignoreHTTPSErrors: true,
    viewport: { width: 1720, height: 1200 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
    ],
  });

  try {
    const extensionId = await getExtensionId(context);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await configurePopup(popupPage, {
      edaUrl,
      edaUsername,
      edaPassword,
      clientSecret,
      kcUsername,
      kcPassword,
      connect,
      autoLogin,
    });

    const appPage = await context.newPage();
    await appPage.goto(openUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    let directLoginUsed = false;
    for (let i = 0; i < 5; i++) {
      directLoginUsed = await maybeDirectUiLogin(appPage, {
        enabled: directLoginFallback,
        username: edaUsername,
        password: edaPassword,
      });
      if (directLoginUsed) break;
      await appPage.waitForTimeout(1000);
    }

    console.log(`Loaded extension ${extensionId}`);
    console.log(`EDA URL: ${edaUrl}`);
    console.log(`Connected: ${connect ? 'yes' : 'no'}`);
    console.log(`Auto-login: ${autoLogin ? 'enabled' : 'disabled'}`);
    console.log(`Direct login fallback: ${directLoginUsed ? 'used' : 'not needed'}`);
    console.log(`Browser profile: ${profileDir}`);

    if (!keepOpen) {
      await context.close();
      return;
    }

    console.log('Browser is running. Press Ctrl+C to exit.');
    await waitUntilExit();
    await context.close();
  } catch (err) {
    await context.close();
    throw err;
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Failed to launch configured browser: ${message}`);
  process.exit(1);
});
