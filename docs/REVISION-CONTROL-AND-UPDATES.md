# Revision control & remote updates

How code moves from the working tree into version control and out to the Pi — v1's
model, and v2's (simpler, because v2 is one static binary).

## v1 (skylight)

- **Revision control:** a git repo (`gewicker/skydeck`). The appliance lived at
  `~/skylight` on the Pi.
- **Hands-off self-updater** (`skydeck-updater`, 10-min `systemd` timer) with three
  channels in `/etc/skydeck/update.conf`:
  - `git` — `git fetch origin <branch>` + `reset --hard`, then **rebuild on the Pi**
    (`pnpm install && pnpm build`), restart, health-check, rollback to the previous
    commit on failure.
  - `lan` — mDNS-discover a PC publisher (`_skydeck-update._tcp`), pull its
    `manifest.json` (`{version,url,sha256}`) tarball.
  - `http` — poll a fixed manifest URL (no discovery; best on segmented LANs).
  Every channel verified a sha256, promoted `last-good`, and `pkill`ed Chromium so
  the kiosk reloaded — no reboot.
- **Direct push** (`skydeck-push.sh`) — the fast iteration path: `rsync --delete` the
  working tree to `skydeck.local` over a pinned SSH key, then **rebuild + restart on
  the Pi**. Bypassed git and the updater entirely.
- **Publishing** (`skydeck_ship.py` / `skydeck_publish.py`) — built a tarball from the
  tree and served it + a manifest over HTTP with an mDNS advert, for the `lan`/`http`
  channels.

The common cost across all of these: **a build ran on the Pi** (`pnpm install &&
pnpm build`) — the slowest and most failure-prone step.

## v2 (skyview)

**Revision control:** GitHub `gewicker/skyview2`, `main` branch. Tags are versions; a
tag cut to a **GitHub release** (with the prebuilt binary asset) is the deploy
artifact. There is no on-device build, so the v1 `git` channel becomes a
**release** channel — git history stays the source of truth, the release is what
ships.

**Three ways to reach the Pi:**

1. **Hands-off (release channel) — the default.**
   `scripts/release.sh v2.0.0` tags the commit, builds `skyview-linux-arm64` +
   `.sha256` (`make release`), and publishes a GitHub release. Each Pi's
   `skyview-updater` (10-min timer; `CHANNEL=github`, `REPO`, `ASSET` in
   `/etc/skyview/update.conf`) pulls the latest release, verifies the checksum,
   atomically swaps the binary, restarts `skyview`, health-checks `/api/health`, and
   rolls back to `skyview.prev` on failure. Force it now with `skyview update now`.

2. **Instant push (iteration) — `pi-setup/skyview-push.sh`.**
   Cross-compiles arm64, `scp`s the binary to the Pi, installs it, restarts, and
   health-checks. No GitHub, no waiting. Env: `PI_HOST`, `PI_USER`, `SSH_KEY`. This is
   v1's `skydeck-push.sh` minus the rsync-and-rebuild — just a binary swap.

3. **Airgapped / LAN-only (http channel).**
   Publish a manifest `{version,url,sha256}` on the LAN and set `CHANNEL=http`,
   `UPDATE_URL=...` in `/etc/skyview/update.conf`. Same verify+swap+rollback path.

**What's improved vs v1:** the binary swap removes the on-device build (the biggest
failure surface and the slowest step); rollback is restoring one previous binary
instead of un-building; the direct push is `scp` of ~10 MB instead of an rsync +
`pnpm install`. The release/rollback/health-check shape is otherwise identical to v1.

**Build targets:** `make pi` (local arm64 binary), `make release` (named asset +
`.sha256` for a release), `make web` / `make types` for the frontend + generated
types.
