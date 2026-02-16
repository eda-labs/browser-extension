## Requirements

- Node.js 18+ (recommended)
- npm
- Firefox or Chromium-based browser (Chrome/Edge/Brave)

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

## Browser Support

- Runtime code is written against a `browser`/`chrome` compatible API wrapper.
- Current development workflow is Firefox-first (`web-ext run`).
- Current manifest is also Firefox-first (`manifest_version: 3` with `background.scripts` and `browser_specific_settings.gecko`).
- For Chromium packaging/loading, use a Chromium-specific manifest variant (notably `background.service_worker` instead of `background.scripts`).

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
- Do not commit production credentials or environment secrets.
- Avoid logging tokens or sensitive payloads.
- Treat any page integration using `window.postMessage` as trusted-only logic within your environment.
