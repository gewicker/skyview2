# Switching versions & updating — without pulling the card

SkyView 2 runs as the primary; **v1 stays installed as a remote rollback**. You never
have to reflash or remove the SD card to go back to baseline.

## How it works (and why there's no performance cost)

Both versions serve the display on **:3000**, and only the **decoder** (dump1090) owns
the SDR — the display server doesn't. So the two versions are **mutually exclusive**:
exactly one runs at a time, the other is dormant files on disk. Switching is a ~2-second
`systemctl` swap of which unit owns :3000. The shared decoder on :8080 is never touched,
so traffic keeps flowing across a switch. The only cost of keeping both is disk space
(v1's Node app is the chunky one; v2's Go binary is ~15 MB).

```
 dump1090 (SDR, :8080)  ──►  aircraft.json  ──►  [ skyview  OR  skylight-server ] :3000  ──►  kiosk
        shared, always up                              one active at a time
```

## Install v2 alongside a running v1

`install-on-pi.sh` stops the v1 service (`skylight-server`), starts v2 (`skyview`), and
leaves v1 **installed** as the rollback. Your v1 config is migrated separately
(`skyview-server -migrate`); nothing is deleted.

## Switch / roll back

```
skyview switch status     # which version is live + health
skyview switch v1          # roll back to the v1 baseline
skyview switch v2          # return to SkyView 2
skyview rollback           # shortcut for: switch v1
```

It's health-checked: if the target doesn't come up on :3000, it reverts automatically.
Run it remotely over SSH for a hands-off rollback:

```
ssh pi@skyview.local skyview rollback
```

## Updating

Default channel is **GitHub releases** (signed, sha256-verified binary swap with
`.prev` rollback). For tight dev iteration, switch to the **git build-on-device**
channel — every push to `origin/main` is fetched, built on the Pi (`make pi`),
swapped in, health-checked, and auto-rolled-back on failure:

```
bash pi-setup/use-git-channel.sh      # needs Go + Node/npm on the Pi
```

Channels live in `/etc/skyview/update.conf` (`CHANNEL=github|http|git`). The 10-minute
timer drives it; `skyview update now` runs it on demand, `skyview auto on|off` toggles
the timer.
