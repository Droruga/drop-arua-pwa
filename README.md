# Drop — Mbarara product catalogue ordering PWA

Drop is a lightweight, mobile-first product catalogue and WhatsApp ordering PWA for Mbarara, Uganda. Customers browse the owner-supplied catalogue, build a persistent cart, provide delivery details, and send an order to the Drop dispatch team through WhatsApp.

## Customer flow

1. Browse one of the seven catalogue categories and its subcategories.
2. Search products by name or category/subcategory.
3. Add products to the persistent cart and adjust quantities.
4. Enter delivery address, landmark, optional GPS pin, contact details, delivery timing, payment preference and notes.
5. Confirm any age-restricted or prescription-related acknowledgement required by the selected products.
6. Submit the order. Drop saves a local order record and opens WhatsApp with a structured message. If WhatsApp does not open, the confirmation screen displays the complete message and a copy action.
7. Revisit read-only order history from the top bar. Orders are newest first, expandable for full details, and limited to the latest 50 records on the device.

## Product and price rules

- Currency is UGX.
- Product names, units, availability and prices come from `catalog.json`; do not invent products or edit the owner's catalogue data as part of UI work.
- Prices are displayed as a minimum–maximum range. The range is an estimate, not a final quote.
- Drop confirms final product prices, availability and delivery fee on WhatsApp.
- The app does not use product photography. Category and interface visuals use the inline SVG icon system.
- Out-of-stock products cannot be added to the cart.
- Age-restricted products require an 18+ confirmation. Prescription-required products require acknowledgement that a valid prescription may be requested.

## Stack

| Layer | Choice |
|---|---|
| Markup | Semantic HTML with an inline SVG icon sprite |
| Styles | Token-driven CSS in `styles.css` |
| Script | Vanilla ES2020 in `app.js`, no framework or dependencies |
| Catalogue | Owner-maintained `catalog.json` loaded by `catalog.js` |
| Fonts | Self-hosted Plus Jakarta Sans |
| Offline | Service worker with a versioned application-shell cache |
| Hosting | Netlify static hosting; publish directory `.` |

## WhatsApp dispatch

The dispatch number is defined once in `app.js`:

```js
const DISPATCH_PHONE = "256702964822";
```

Keep this value unchanged unless the Drop owner explicitly supplies a replacement. The WhatsApp message includes the order reference (`ORD-YYYYMMDD-XXX`), customer and delivery details, item names/units/quantities, price ranges, estimated subtotal, delivery-fee confirmation note, payment preference, timing, GPS pin when supplied, and applicable age/prescription notes. The message ends with: `Reply CONFIRM to accept.`

The customer must still tap Send in WhatsApp. The PWA does not receive a WhatsApp delivery/read receipt.

## Local data and privacy

- Cart, checkout profile and order history are stored in the customer's browser using localStorage.
- Order history is device-local and is not synced to dispatch or another device.
- The latest 50 orders are retained. Older legacy `drop_orders` records are migrated into `drop_history_v1` on first read.
- Clearing browser/site data removes locally stored cart, profile and history.
- Orders are saved before the WhatsApp handoff, so a failed handoff can be retried from the confirmation screen while it remains open.
- There is no backend, account system, central order database, or server-side order recovery.

## Run locally

1. Clone or download this repository.
2. Open the project folder in VS Code.
3. Use VS Code Live Server or another static local server.
4. Open the local HTTP address on a phone or desktop.

Do not open `index.html` with `file://`: service workers, install prompts and geolocation require HTTP(S) (GPS also works on localhost).

## Deploy to Netlify

- Publish the repository root (`.`); no build command is required.
- Test the deployed HTTPS URL on Android Chrome and iOS Safari.
- Bump `CACHE_VERSION` in `sw.js` whenever a shipped asset changes.
- The service worker uses network-first for navigations and application-shell assets, with cached fallbacks for offline use.

## PWA icons

The existing Drop red-and-white icon assets and self-hosted fonts are retained. PNG launcher icons are full-bleed squares; the separate maskable artwork keeps the symbol within the central safe zone.

## Before public launch

- Confirm catalogue accuracy, product availability and partner fulfilment.
- Confirm service coverage and delivery fee handling in Mbarara.
- Test WhatsApp installed/not installed and copy fallback behaviour.
- Test scheduled delivery validation, GPS allowed/denied, age and prescription checks.
- Test offline launch and catalogue-load failure messaging.
- Test cart persistence, order-history migration and the 50-order cap on Android Chrome and iOS Safari.
- Provide a customer-facing privacy policy and support contact.
