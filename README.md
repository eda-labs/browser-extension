# EDA Browser Extension

Firefox extension for connecting browser pages to an EDA backend with authenticated proxy requests.

## What It Does

- Manages one or more saved EDA targets in the popup UI.
- Connects/disconnects using EDA username/password + client secret.
- Refreshes access tokens automatically before expiry.
- Proxies authenticated API requests from page scripts through the extension runtime.
- Broadcasts connection status updates to pages.
- Can fetch the `eda` Keycloak client secret from the popup (with Keycloak credentials).

## Requirements

- Node.js 18+ (recommended)
- npm
- Firefox (for `web-ext run`)

## Install

```bash
npm install
```

## Build and Run

- `npm run build`: production build to `dist/`
- `npm run watch`: rebuild on source changes
- `npm run dev`: build and launch in Firefox via `web-ext run`
- `npm run typecheck`: TypeScript checks (`tsc --noEmit`)
- `npm run lint`: lint built extension with `web-ext lint`
- `npm run package`: build + lint + create extension package
- `npm run clean`: remove `dist/` and `web-ext-artifacts/`

## Development Workflow

1. Run `npm install`.
2. Run `npm run dev`.
3. Use the popup to:
   - create/save a target,
   - connect,
   - verify status chip updates,
   - disconnect and/or delete target.
4. Before submitting changes, run:
   - `npm run typecheck`
   - `npm run build`
   - `npm run lint`

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
- Do not commit real credentials or environment secrets.
- Avoid logging tokens or sensitive payloads.
- Treat any page integration using `window.postMessage` as trusted-only logic within your environment.

