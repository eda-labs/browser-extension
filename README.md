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

[firefox-dl-badge]: https://github.com/user-attachments/assets/e5c90af9-06b4-4c61-a91c-77179218fd71
[firefox-latest-xpi]: https://github.com/eda-labs/browser-extension/releases/latest/download/eda_browser_extension.xpi
[chrome-latest-crx]: https://github.com/eda-labs/browser-extension/releases/latest/download/eda_browser_extension.crx
[open-ext-screenshot]: https://github.com/user-attachments/assets/0148140d-9d68-4a1e-ad2f-ced92a7b59dd
