# EDA Browser Extension

A browser extension to let web pages interact with the Nokia EDA HTTP REST API.

## Installation

### Firefox

Simply click on the below badge to install/update:

[![][firefox-dl-badge]][firefox-latest-xpi] 

### Chrome/Edge

Chrome and Edge install this extension as an unpacked directory (not by double-clicking a `.zip`).

1. Download `eda_browser_extension-<version>.zip` from the [latest release](https://github.com/eda-labs/browser-extension/releases/latest/).
2. Extract the zip to a folder.
3. Open `chrome://extensions` (or `edge://extensions`).
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the extracted folder.

Optional: for environments that allow CRX sideloading, download `eda_browser_extension.crx` from the release and install it from the extensions page.

## TLS Certificates

If your EDA installation is using self-signed certs, or using a certificate not trusted by your browser. Please use the 'open EDA UI' icon to navigate to the EDA UI page and accept the safety warning from the browser and trust the certificate.

![][open-ext-screenshot]

## Settings

The popup now includes a settings button (gear icon) that opens extension settings in a dedicated browser tab.

Current settings:
- Target setup (EDA URL, username/password, client secret, auto-login toggle)
- Spotlight hotkey (default: `Ctrl/Cmd + K`)

Popup flow:
- Select target
- Connect / disconnect

## Dev Launcher (Chromium + .env)

You can start Chromium with the extension installed and pre-configured from `.env`:

1. Create `.env` from `.env.example` and set your values.
2. Run:

```bash
npm run dev:chromium:env
```

Useful options:

- `EDA_CLIENT_SECRET`: if left empty, the launcher fetches it using `EDA_KC_USERNAME` / `EDA_KC_PASSWORD`.
- `EDA_RESET_PROFILE=true|false`: wipe persistent Chromium profile before launch (default `true`).
- `EDA_KEEP_OPEN=true|false`: keep browser running until Ctrl+C (default `true` when not headless).
- `EDA_DIRECT_LOGIN_FALLBACK=true|false`: if Keycloak login is visible, fill and submit it directly with `EDA_USERNAME` / `EDA_PASSWORD` (default `true`).
- `EDA_HEADLESS=true|false`: run headless (default `false`).
- `EDA_ENV_FILE=/path/to/file`: use a custom env file path.
- `npm run dev:chromium:env:no-build`: skip extension rebuild.

[firefox-dl-badge]: https://github.com/user-attachments/assets/e5c90af9-06b4-4c61-a91c-77179218fd71
[firefox-latest-xpi]: https://github.com/eda-labs/browser-extension/releases/latest/download/eda_browser_extension.xpi
[chrome-latest-crx]: https://github.com/eda-labs/browser-extension/releases/latest/download/eda_browser_extension.crx
[open-ext-screenshot]: https://github.com/user-attachments/assets/0148140d-9d68-4a1e-ad2f-ced92a7b59dd
