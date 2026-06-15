# How v1 works, and how v2 maps to it

A deep accounting of the proven v1 (`skylight`) appliance, so v2 is built
fundamentally the same way — same data flow, same topology, same reliability — and
only deviates deliberately. Citations are to the v1 tree.

## Data pipeline

RTL-SDR → FlightAware `dump1090` decodes ADS-B and writes `/run/dump1090-fa/aircraft.json`
once per second (`--write-json-every 1`). A bare `python3 -m http.server 8080
--directory /run/dump1090-fa` exposes it.

**The authoritative URL is `http://localhost:8080/aircraft.json` (root).** The
`/data/aircraft.json` string in v1's code (`index.ts:32`) is a latent bug — there is
no `/data/` path on the from-source build; the deployed `skylight-server.service`
env overrode it to the root path. *v2 default is the root path, and the poller
auto-falls-back to the sibling `/data/` layout so FlightAware/lighttpd installs also
work without config.*

The server polls every 1 s (5 s timeout), accepts `aircraft` or `ac` arrays, and
normalizes the readsb schema. `alt_baro` is a number **or the string `"ground"`** (a
sentinel → on-ground, null altitude). Decoder-derived Mode-S EHS winds (`ws`/`wd`/`oat`)
ride in the same JSON and feed the winds overlay — easy to drop in a rewrite.

When on radio with `SUPPLEMENT_API`, it also polls airplanes.live every 4 s and
merges by hex: radio freshness biased −2 s, a missing API `seen` treated as **6**
(not 999 — that was a real bug where radio won forever and landing aircraft vanished),
radio wins while `rSeen <= aSeen`. Local radio leads; the API takes over only once
the radio fix is ~8 s stale.

Enrichment: instant bundled-table lookups (airline by callsign prefix, type by ICAO
code) plus cached adsbdb route/aircraft (12 h TTL, negative-cached, disk-persisted,
one in-flight request per key, background-fetched so the render loop never blocks).
Stickiness has **two scopes**: type/registration stick by **hex** (airframe);
airline/route stick by **callsign** (tagged `routeFlight`) so a new leg under a
different callsign can't show the previous leg's origin/destination. Snapshots
broadcast over WS at 1 Hz; the browser keeps its own history, renders ~1.15 s in the
past, and interpolates between real fixes (dead-reckon only past the newest, capped).

## Server / web topology

One `http.Server` on `0.0.0.0:3000` backs both Express and the WS upgrade. The built
Vite bundle (React 18, multi-page: `index.html` + `control.html`, hashed `/assets/*`)
is served by `express.static(web/dist)` plus **two explicit routes**: `GET /` →
`index.html` (display), `GET /control` → `control.html` (phone). **No SPA fallback** —
`/control` works only because of the explicit route; v2 must replicate this or the
phone URL 404s. WS path is `/ws`; the client derives host/proto from `location`, so
the kiosk and phone each connect to their own origin. Role (`display`/`control`) is a
client-side optimization only (control drops `aircraft` frames); the server treats
all clients identically. On connect the hub **primes** the client with config + the
current aircraft snapshot (+ status/scenes/notable) — there's no separate REST
bootstrap. config.json/scenes.json persist (debounced 400 ms, non-atomic in v1);
notable is in-memory only.

## Provisioning, boot, update

Windows `flash_skydeck.py` (config-driven, self-elevating) flashes Raspberry Pi OS,
writes a base64-packed `firstrun.sh` + patches `cmdline.txt`, stages the app, then
SSHes in to run the installer under `nohup` and polls for READY/PROBLEM. `firstrun.sh`
sets identity/WiFi/SSH/passwordless-sudo and installs an **onboarding net**: a status
file plus a `SkyDeck-setup` recovery hotspot if WiFi fails (so a bad join is never a
dead end). `install-on-pi.sh` builds the RTL-SDR driver, dump1090-fa (two services on
:8080), and the app, then `setup-kiosk.sh`, `harden-pi.sh`, and `enable-auto-update.sh`.

Service topology: `dump1090-fa` → `dump1090-json` (:8080) → `skylight-server` (:3000),
a desktop-session **kiosk supervisor** (Xwayland workaround for Pi 5, health-wait,
unclutter, supervise loop, nightly 04:30 refresh, compositor autodetect), a 2-min
**self-heal** timer (restart dead services, re-up WiFi, reboot after 20 min offline
rate-limited), a 10-min **auto-updater** (manifest + sha256, health-check, rollback,
kiosk reload — no reboot), a hardware **watchdog**, journald **volatile/64 M**, and
**avahi** `_skydeck._tcp:3000`. `harden-pi.sh --seal` makes the root read-only.

## v2 alignment (what's the same, what changed)

**Same:** root `aircraft.json` URL; 1 Hz poll + readsb normalizer incl. `ground`
sentinel and winds fields; the −2 s / `?? 6` merge numbers; two-scope enrichment
stickiness; `/` + `/control` explicit routing with no SPA fallback; `/ws` on the same
`0.0.0.0:3000` server; on-connect prime; the dump1090 services; the kiosk supervisor;
2-min self-heal; watchdog; journald-volatile; mDNS (`_skyview._tcp`); seal/unseal;
the operator CLI surface.

**Improved:** single static Go binary (no Node/pnpm build on the Pi) → the updater is
a verified **binary swap** (extract+restart, no on-device build — the biggest v1
failure surface removed); config/scene writes are **atomic** (temp+rename, fixing
v1's non-atomic writes + the lost-last-edit-on-shutdown bug via a SIGTERM flush);
**canonical Web Mercator** projection so basemap and traffic register exactly; the
radio poller **auto-detects** root vs `/data/` layout; bounded enrichment/photo caches.

**Still TODO (parity work ahead):** the airplanes.live API-supplement merge
(config ported, wiring after live confirmation); adsbdb enrichment + tables + photo +
TLE proxies (stubs); scenes/notable stores + their WS messages; the Windows flasher
(`flash_skyview`) + firstrun onboarding hotspot; the client render-delay + interpolated
motion model in the renderer.
