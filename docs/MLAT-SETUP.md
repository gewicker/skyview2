# MLAT — put non-ADS-B aircraft on the map

MLAT (multilateration) computes the position of aircraft that **don't** broadcast their own position —
older airliners, most military, and GA that only replies to secondary radar (Mode S/A/C) — by comparing
the *arrival time* of the same Mode-S reply at several receivers. It's the single best "make the map
busier" upgrade, and it runs off your **working 1090 feed** — completely independent of the 978/UAT side.

On the SkyView side there's **nothing to build**: `mlat-client` injects the resolved positions back into
`dump1090-fa`, which lists them in its `aircraft.json` (tagged `"mlat"`), and SkyView already reads that
file. MLAT targets simply appear as contacts.

## The honest tradeoffs (decide before installing)

- **You must feed an aggregator.** Multilateration needs many cooperating receivers, so `mlat-client`
  sends your Mode-S timing (and your receiver's location) to a shared MLAT server. If you're not
  comfortable sharing that, MLAT isn't for you — there's no local-only MLAT.
- **Yield depends on neighbors.** A position only resolves when **3–4+ receivers** hear the same aircraft
  at once. Near a metro like Seattle that's realistic and you'll get a real set of extra targets; in a
  receiver-sparse area you may get few. It's "modest but real," not a flood.
- **Accuracy is coarser** than ADS-B (it's a time-difference solution). Fine for a glanceable display.

## Prerequisites

`dump1090-fa` must be running with networking so `mlat-client` can read its Beast output and inject
results. FlightAware's service does this by default (Beast **out** on `:30005`, Beast **in** on `:30104`).
Quick check:
```
timeout 2 bash -c 'exec 3<>/dev/tcp/127.0.0.1/30005' && echo "Beast out OK"
```

## What you provide

MLAT math depends on your antenna's exact position — the installer will not guess it:

| Env | Meaning | Example |
|-----|---------|---------|
| `RECEIVER_LAT` | antenna latitude, decimal degrees | `47.6062` |
| `RECEIVER_LON` | antenna longitude, decimal degrees | `-122.3321` |
| `RECEIVER_ALT` | antenna height above sea level | `60` (meters) or `197ft` |
| `MLAT_USER` | a handle the aggregator shows for you | `skyview-georgew` |
| `MLAT_SERVER` | the aggregator's MLAT server `host:port` | see below |

Use your **antenna's** location (roughly where the aircraft signals are received), as precise as you can —
even ~25 m of error degrades MLAT quality.

## Pick an aggregator (get the MLAT server host:port)

MLAT is free at several community aggregators. Endpoints change occasionally, so **confirm the current one
from the aggregator's "feed" page** before running. Popular, privacy-conscious options:

- **adsb.lol** — community, no account; feed instructions list the MLAT server. (https://adsb.lol/feed/)
- **adsb.fi** — community, no account. (https://adsb.fi/)
- **airplanes.live** — community. (https://airplanes.live/how-to-feed/)
- **ADSBExchange** — the largest network; uses its own feed client/registration. (https://www.adsbexchange.com/data-sharing/)

You can feed more than one, but start with **one** to keep it simple. Grab that aggregator's MLAT
`host:port` for `MLAT_SERVER`.

## Install + run

```
cd ~/skyview2
sudo RECEIVER_LAT=47.6062 RECEIVER_LON=-122.3321 RECEIVER_ALT=60 \
     MLAT_USER=skyview-georgew MLAT_SERVER=<aggregator-mlat-host:port> \
     bash pi-setup/install-mlat.sh
```
(Substitute your real values.) The script builds `mlat-client` (wiedehopf fork, in an isolated venv),
installs `skyview-mlat.service`, and starts feeding.

## Verify

```
journalctl -u skyview-mlat -f
# look for: "synchronized with N nearby receivers" — that's MLAT working.
curl -s localhost:8080/aircraft.json | grep -c '"mlat"'
# count of MLAT-resolved fields; grows once enough neighbors hear the same aircraft (can take minutes).
```
On the map, MLAT aircraft render as normal contacts. A **faint "mlat" style** (to mark them as advisory,
like TIS-B) is an easy optional follow-up — the readsb schema already carries an `mlat` field per
aircraft, so the client can style them distinctly without any new plumbing.

## Uninstall / stop
```
sudo systemctl disable --now skyview-mlat.service
```
Removing it leaves the 1090 (and 978) pipelines untouched.
