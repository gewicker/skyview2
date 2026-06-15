# Clean swap & rollback (a pristine Pi each time)

v1 and v2 are namespace-isolated — distinct services, drop-ins, config dirs, state,
data, kiosk entries, and mDNS files. They share only port :3000 (so one runs at a
time) and the ADS-B decoder on :8080 (kept across swaps — it's the radio). Each
generation's installer has a matching surgical uninstaller, so you can move between
them cleanly and reversibly without reflashing.

What's removed by an uninstaller: its app binary, the `*-server`/`*-update`/
`*-selfheal` services, the watchdog + journald drop-ins, `/etc/<name>`,
`/var/lib/<name>`, the kiosk launcher + autostart entry + nightly cron, and the mDNS
advert. What's kept: the dump1090 decoder services (unless `--all`) and, unless
`--purge`, your saved config/scenes.

## v1 → v2

```
# on the Pi (both scripts are in skyview2/pi-setup/)
bash clean-v1.sh                 # remove v1 cleanly (keeps the decoder)
bash install-on-pi.sh            # install v2 (binary + services + hardening + kiosk)
```
If v1's OS was sealed read-only, `sudo raspi-config nonint disable_overlayfs` + reboot
first, or the removals won't persist.

## v2 → v1 (rollback)

```
bash skyview-uninstall.sh        # remove v2 cleanly (keeps the decoder)
# then reinstall v1 from its repo:
cd ~/skylight && bash pi-setup/bootstrap.sh
```
Keep the `~/skylight` tree around (don't `clean-v1.sh --purge`) if you want a fast
rollback — v1 rebuilds from source.

## Nuclear-clean (truly pristine OS)

Reflash the SD card and reprovision. This is the only way to guarantee zero residue
(no leftover apt packages, drivers, or OS tweaks). The Windows flasher that automates
this for v2 is on the parity-TODO list; until then, swap via the uninstallers above —
they leave nothing of the app layer behind.

## Coexistence note

Don't run both at once: both bind :3000, install a kiosk, a self-heal, an updater, and
an mDNS advert. Always uninstall one before installing the other. The decoder is the
one shared component and is safe to leave running throughout.
