## Requirements

- Node.js 18+ (recommended)
- pnpm
- Firefox, Chromium-based browser (Chrome/Edge/Brave), or Safari (local testing)

## Install

```bash
pnpm install
```

## Build and Run

- `pnpm run build`: production build to `dist/`
- `pnpm run package:safari`: create Safari zip artifact at `web-ext-artifacts/eda_browser_extension_safari.zip` (unzip before temporary install in Safari)
- `pnpm run watch`: rebuild on source changes
- `pnpm run dev`: build and launch in Firefox via `web-ext run`
- `pnpm run dev:chromium`: build and launch Chromium with the extension loaded, then open the EDA URL from `.env`
- `pnpm run typecheck`: TypeScript checks (`tsc --noEmit`)
- `pnpm run lint`: lint built extension with `web-ext lint`
- `pnpm run package`: build + lint + create extension package
- `pnpm run clean`: remove `dist/` and `web-ext-artifacts/`

## Dev Launcher (Chromium + .env)

`pnpm run dev:chromium` expects a `.env` file in the repo root. Start from `.env.example`.

Useful variables:

- `EDA_URL`: required base URL to open.
- `EDA_OPEN_URL=https://...`: optional page to open instead of `EDA_URL`.

## Browser Support

- Runtime code is written against a `browser`/`chrome` compatible API wrapper.
- Current development workflow is Firefox-first (`web-ext run`).
- Base manifest is Firefox-first (`manifest_version: 3` with `background.scripts` and `browser_specific_settings.gecko`).
- Chromium and Safari builds rewrite background config to `background.service_worker` and remove Firefox-only settings.

## Development Workflow

1. Run `pnpm install`.
2. Run `pnpm run dev`.
3. Use the popup to:
   - create/save a target,
   - connect,
   - verify status chip updates,
   - disconnect and/or delete target.
4. Before submitting changes, run:
   - `pnpm run typecheck`
   - `pnpm run build`
   - `pnpm run lint`

## Popup Usage

1. Open the extension popup.
2. Create/select a target.
3. Fill:
   - `EDA URL`
   - `EDA User` username/password
   - `Client Secret` (paste manually or use **Fetch**)
4. Click **Connect**.
5. Use **Disconnect** to end the active session.

Notes:
- Passwords are entered for the current connect action and are not persisted.
- Target metadata (URL/username/client secret) is stored in extension local storage.


### Health/Status

Request:

```js
window.postMessage({ type: 'eda-ping' }, '*');
```

Response event:

```js
// window "message" event payload
{
  type: 'eda-pong',
  status: 'disconnected' | 'connecting' | 'connected' | 'error',
  edaUrl: string
}
```

### Authenticated EDA Request

Request:

```js
window.postMessage({
  type: 'eda-request',
  id: 'req-1',
  path: '/core/...',      // appended to connected EDA URL
  method: 'GET',          // optional, defaults to GET
  headers: {},            // optional
  body: undefined,        // optional (string)
}, '*');
```

Response event:

```js
{
  type: 'eda-response',
  id: 'req-1',
  ok: boolean,
  status: number,
  body: string
}
```

### Status Change Broadcast

When connection state changes, pages receive:

```js
{
  type: 'eda-status-changed',
  status: 'disconnected' | 'connecting' | 'connected' | 'error',
  edaUrl: string
}
```

## Permissions and Security Notes

- Manifest uses `storage` permission and `<all_urls>` host/content script matching.
- Do not commit production credentials or environment secrets.
- Avoid logging tokens or sensitive payloads.
- Treat any page integration using `window.postMessage` as trusted-only logic within your environment.
