# CareConnect

A mobile-first, location-aware essential-services and emergency-assistance
web app. CareConnect is **not** a medical diagnosis tool — it never assesses
severity or gives medical judgment. It classifies a situation into a
*service category* only, then helps the person find, contact, navigate to,
or share nearby real-world services.

## Running it

This app must be **served over HTTP(S)**, not opened as a `file://` page —
the Geolocation API, Service Worker, and IndexedDB all require a proper
origin (`localhost` counts).

```bash
cd careconnect
python3 -m http.server 8080
# open http://localhost:8080
```

For a real deployment, any static host works (Vercel, Netlify, GitHub
Pages, S3 + CloudFront, your own nginx). Serve over HTTPS — geolocation and
service workers require it outside `localhost`.

## Architecture (matches the brief's layer separation)

| Layer | File | Responsibility |
|---|---|---|
| UI | `js/ui.js` | All DOM/Leaflet rendering. Never fetches data itself. |
| Location | `js/location.js` | Geolocation acquisition, accuracy classification, watch/retry. |
| Data | `js/data.js` | Overpass API queries, category taxonomy, distance calc, request caching/coalescing. |
| Offline | `js/offline.js` | IndexedDB (20 km saved area), connectivity + battery status, SW registration. |
| Intent | `js/intent.js` | Free-text situation → service category list. Classification only, never diagnosis. |
| Action | `js/actions.js` | Call, directions hand-off, location sharing (Web Share API + clipboard fallback). |
| Orchestrator | `js/app.js` | Local auth (MVP), app state, wires the layers to the UI. |

## What's real vs. intentionally out of scope for this MVP

**Real and working:**
- Actual browser Geolocation with `enableHighAccuracy`, real accuracy
  reporting, retry, and continuous `watchPosition` updates.
- A real Leaflet + OpenStreetMap map with markers, popups, accuracy
  circle, and a recenter control.
- Real nearby-service data from the Overpass API (hospitals, pharmacies,
  clinics, blood donation points, police, fire stations, fuel, vehicle
  repair, accessible facilities). No business, phone number, rating, or
  opening hour is ever invented — missing fields render as
  "Information not provided."
- A situation → category classifier (`intent.js`) that is fully
  data-driven and auditable, and explicitly does not diagnose.
- One-tap `tel:112` and `tel:1033` (labeled plainly as India's emergency
  number and National Highway assistance — never as a universal
  petrol-delivery line), plus Web Share API location sharing with a
  Google Maps coordinate link and clipboard fallback.
- A genuine 20 km offline download into IndexedDB, with a saved
  timestamp, a "Clear Offline Data" control, and a LIVE vs. OFFLINE DATA
  indicator that is never shown as live when it isn't.
- Installable PWA shell (manifest + service worker caching only static
  assets — never the user's account or location).
- Real Battery Status API and `navigator.onLine` reporting when the
  browser exposes them; nothing fabricated when it doesn't.
- Real flashlight control via `getUserMedia` + `ImageCapture` torch
  constraint where the platform supports it; an honest message
  ("Flashlight control isn't available in this browser") everywhere else.

**Deliberately simplified / flagged for production hardening:**
- **Auth** is local-only (`localStorage`, SHA-256 hashed password) as the
  brief scoped for an MVP. Replace with a real backend + proper auth
  before handling real accounts across devices.
- **Overpass is called directly from the browser.** This is fine for a
  prototype but will hit public rate limits under real traffic. Put a
  thin backend/cache in front of it before production (the Data Layer's
  `fetchOverpass` is the only place that would need to change — it
  already round-robins two public mirrors and coalesces/caches
  requests client-side).
- **Offline mode caches the service list, not map tiles.** When fully
  offline the app shows the saved 20 km service list and distances
  accurately; the map panel itself will show blank tiles rather than a
  fabricated offline basemap. Adding a tile cache (e.g. via
  `leaflet.offline`) is a natural next step.
- **Driving distance/ETA is not implemented** — "Directions" hands off to
  Google Maps for real turn-by-turn routing rather than approximating it,
  per the brief's instruction not to confuse straight-line distance with
  driving distance.
- **Ratings** are left blank throughout: OpenStreetMap has no reliable,
  general rating field, and the brief prohibits fabricating one.

## Testing checklist

See the brief's own §28 — this build was structured so each item is
independently verifiable:
- Auth: sign up, log in with wrong password, refresh (session persists),
  log out.
- Location: allow / deny permission, observe accuracy label change
  outdoors vs. indoors, tap retry after denial.
- Map: pan/zoom, marker popups, recenter button.
- Services: switch category filters, use the situation search box with
  each example phrase in the brief.
- Emergency Mode: each tile prioritizes the categories described in the
  brief's §8 table.
- Offline: download the 20 km area, turn off networking (e.g. DevTools
  "Offline"), reload, confirm the OFFLINE DATA badge and saved-timestamp
  appear, reconnect, refresh.
- Battery/connectivity chips: only appear when the browser actually
  exposes the data.

## Privacy

Location is only sent to: (1) OpenStreetMap tile/Overpass requests needed
to show the map and nearby services, and (2) wherever the user explicitly
taps "Share location" or "Call." Nothing is transmitted in the background.
Offline data and the account record live only in this browser and can be
cleared from Settings.
