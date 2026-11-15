# Drop — errands & home services PWA

A lightweight, no-build-step PWA. It uses HTML, CSS and vanilla JavaScript, stores customer details and orders in the browser, and hands requests to WhatsApp dispatch.

## Stack

| Layer | Choice |
|---|---|
| Markup | Semantic HTML with an inline SVG icon sprite |
| Styles | One readable, token-driven stylesheet (`styles.css`) |
| Script | Vanilla ES2020 (`app.js`), no framework, no dependencies |
| Fonts | Self-hosted Plus Jakarta Sans (variable, wght 200–800), SIL OFL 1.1 |
| Offline | Service worker with a versioned application shell cache |
| Hosting | Netlify (static, `netlify.toml` for headers) |

## Run locally

1. Unzip the project.
2. Open the folder in VS Code.
3. Use the VS Code Live Server extension, or run any static local server.
4. Open the local HTTP address on your phone or desktop.

Do not test by double-clicking `index.html` (`file://`): service workers and install prompts require an HTTP(S) origin. GPS generally requires HTTPS or localhost.

## Configure WhatsApp dispatch

Open `app.js` and replace:

```js
const DISPATCH_PHONE = "2567XXXXXXXX";
```

Use digits only, including Uganda's country code `256`, without `+`, spaces, or the leading domestic `0`. Example format: `256772000000`.

Until configured, the app intentionally blocks order submission rather than silently sending to an invalid destination.

## Deploy to Netlify

1. Go to Netlify and choose **Add new site → Deploy manually**.
2. Drag the unzipped project folder (the folder containing `index.html`) into the deploy area.
3. Netlify publishes the static site. No build command or environment variables are required.
4. Test the deployed HTTPS URL on an Android phone.
5. Set your final dispatch number in `app.js` and redeploy.

Alternatively, push the folder to a Git repository and import it into Netlify. Set the publish directory to `.` and leave the build command empty.

### Disable the Netlify badge

Netlify injects a "Powered by Netlify" badge at its edge. It is not part of this project's HTML, CSS or JavaScript, and it cannot be removed from the code. Turn it off in the Netlify UI:

> **Project configuration → General → Powered by Netlify badge → Off**

This takes effect on the next request and needs no redeploy. It is worth doing: on a 412 px phone viewport the badge overlaps roughly 93 % of the "My drops" navigation button and intercepts taps on it.

## Admin status update links

A status link updates an order only in the browser/device where it is opened, and only if that order already exists in that browser's `localStorage`.

Supported statuses:
- `sent` — Request Sent
- `assigned` — Runner Assigned
- `progress` — In Progress
- `completed` — Completed

Example:

```text
https://YOUR-SITE.netlify.app/?order=DRP-842123&status=assigned&runner=Brian&runnerPhone=0772000000
```

The order ID must match the ID generated for that customer's order. For a runner phone, use a dialable number such as `0772000000` or `+256772000000`.

### Important limitation

This is deliberately a zero-backend prototype. There is no central order database, dispatch dashboard, identity verification, or secure admin authentication. Query parameters are not signed: anyone who can construct a valid link for an order ID can change that order's status on the device where the link is opened. Do not treat these links as secure administrative controls or use them for sensitive operations.

For real multi-device tracking, add a small authenticated backend or managed database later. The present implementation is suitable for validating the customer flow and WhatsApp dispatch process.

## Customer data & privacy

- Name, phone, last landmark and order history are stored in local browser storage.
- Data remains on that device/browser and is not synced to another device.
- Clearing site data/browser storage deletes the locally saved records.
- A WhatsApp handoff opens a prefilled message. The customer must tap Send in WhatsApp.
- The app does not receive a delivery/read receipt from WhatsApp.

## Service options

Radio groups (compound size, cylinder size, refill station, cleaning scope, repair category) are **never preselected**. The customer must choose explicitly, and the WhatsApp payload always contains the option they actually picked. A group left untouched blocks submission with an inline message.

## PWA icons

| File | Size | Purpose |
|---|---|---|
| `icons/drop-icon.svg` | 512 | Editable vector source for the standard icon |
| `icons/drop-maskable.svg` | 512 | Editable vector source for the maskable icon |
| `icons/drop-512.png` | 512×512 | Standard launcher icon (`purpose: any`) |
| `icons/drop-192.png` | 192×192 | Standard launcher icon (`purpose: any`) |
| `icons/drop-maskable-512.png` | 512×512 | Maskable launcher icon (`purpose: maskable`) |
| `icons/apple-touch-icon-180.png` | 180×180 | iOS home-screen icon |

All PNGs are full-bleed squares with no pre-rounded outer corners, so Android adaptive masks and the iOS squircle are applied exactly once. The maskable artwork is a genuinely separate file with the symbol scaled into the central 80 % safe zone.

Regenerate the PNGs from the SVG sources with any SVG rasteriser at the sizes above.

## Service worker and releases

`sw.js` precaches an explicit application shell under a versioned cache name (`drop-shell-v3`):

- Navigations: network first, cached `index.html` as the offline fallback.
- Shell assets (CSS, JS, manifest, icons, fonts): network first so a redeploy always reaches returning visitors, with the cache as the offline fallback.
- Everything else, including Netlify's injected scripts, is left to the browser and is never cached.

**Bump `CACHE_VERSION` in `sw.js` whenever you change a shipped asset.** The cache name is the only thing that invalidates the previous shell for existing users; without a bump, returning visitors keep the old CSS and JavaScript.

## Before public launch

- Replace the dispatch number.
- Turn off the Netlify badge (see above).
- Confirm service coverage, pricing, and dispatch availability.
- Add a real privacy policy and customer support contact.
- Test on Android Chrome and iOS Safari.
- Test GPS permission denied, offline launch, WhatsApp installed/not installed, and all service forms.
- Consider a backend before relying on status links for live operations.
