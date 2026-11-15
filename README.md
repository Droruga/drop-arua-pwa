# Drop — Arua errands & home services PWA

A lightweight, no-build-step PWA. It uses HTML, CSS and vanilla JavaScript, stores customer details/orders in the browser, and hands requests to WhatsApp dispatch.

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
2. Drag the unzipped `drop-pwa` folder (the folder containing `index.html`) into the deploy area.
3. Netlify publishes the static site. No build command or environment variables are required.
4. Test the deployed HTTPS URL on an Android phone.
5. Set your final dispatch number in `app.js` and redeploy.

Alternatively, push the folder to a Git repository and import it into Netlify. Set the publish directory to `.` and leave the build command empty.

## Admin status update links

A status link updates an order only in the browser/device that opens it, and only if that order already exists in that browser's `localStorage`.

Supported statuses:
- `sent` — Request Sent (25%)
- `assigned` — Runner Assigned (50%)
- `progress` — In Progress (75%)
- `completed` — Completed (100%, emerald)

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

## PWA icons

`icons/drop-icon.svg` is the editable vector source. PNG files at 192px and 512px are included for the manifest and Apple touch icon. `drop-maskable-512.png` is the maskable launcher variant.

## Before public launch

- Replace the dispatch number.
- Confirm service coverage, pricing, and dispatch availability.
- Add a real privacy policy and customer support contact.
- Test on Android Chrome and iOS Safari.
- Test GPS permission denied, offline launch, WhatsApp installed/not installed, and all service forms.
- Consider a backend before relying on status links for live operations.
