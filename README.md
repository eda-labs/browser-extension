# EDA Browser Extension

A browser extension to let web pages interact with the Nokia EDA HTTP REST API.

[![][firefox-dl-badge]][firefox-latest-xpi] 
[![][cws-badge]][cws-link]

# Installation

#### Manual install for Chrome/Edge

Chrome and Edge install this extension as an unpacked directory (not by double-clicking a `.zip`).

1. Download `eda_browser_extension-<version>.zip` from the [latest release](https://github.com/eda-labs/browser-extension/releases/latest/).
2. Extract the zip to a folder.
3. Open `chrome://extensions` (or `edge://extensions`).
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the extracted folder.

Optional: for environments that allow CRX sideloading, download `eda_browser_extension.crx` from the release and install it from the extensions page.

### Safari (macOS local/testing install)

Safari supports temporary install from disk for local testing.

1. Build Safari zip artifact: `pnpm run package:safari`.
2. Unzip `web-ext-artifacts/eda_browser_extension_safari.zip`.
3. Open Safari and enable web developer features (`Safari` -> `Settings` -> `Advanced`).
4. Use Safari's temporary extension install from disk workflow and select the extracted folder (the one containing `manifest.json`).
5. In `Safari` -> `Settings` -> `Extensions`, enable the extension and grant website access.

Notes:
- This is intended for local/testing use.

## TLS Certificates

If your EDA installation is using self-signed certs, or using a certificate not trusted by your browser. Please use the 'open EDA UI' icon to navigate to the EDA UI page and accept the safety warning from the browser and trust the certificate.

![][open-ext-screenshot]

## Build

* `npm install` and `npm run dev` - opens a dev firefox with extension loaded
* `npm run build:firefox` or `npm run build:chromium`

[firefox-dl-badge]: https://github.com/user-attachments/assets/e5c90af9-06b4-4c61-a91c-77179218fd71
[firefox-latest-xpi]: https://github.com/eda-labs/browser-extension/releases/latest/download/eda_browser_extension.xpi
[chrome-latest-crx]: https://github.com/eda-labs/browser-extension/releases/latest/download/eda_browser_extension.crx
[open-ext-screenshot]: https://github.com/user-attachments/assets/0148140d-9d68-4a1e-ad2f-ced92a7b59dd
[open-ext-screenshot]: [https://github.com/user-attachments/assets/0148140d-9d68-4a1e-ad2f-ced92a7b59dd
[cws-badge]: https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png
[cws-link]: https://chromewebstore.google.com/detail/eda-browser-extension/jlppjajihmljelejdkidjncdnjadafjf
