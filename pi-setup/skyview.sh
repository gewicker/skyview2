#!/usr/bin/env bash
# SkyView operator command. Installed to /usr/local/bin/skyview by the installer.
# SSH in and run:  skyview status   (or logs / restart / update / health / auto / wifi)
set -uo pipefail
cmd="${1:-status}"

feed() { curl -fsS http://localhost:8080/data/aircraft.json 2>/dev/null; }

case "$cmd" in
  status)
    echo "host    : $(hostname)   ip: $(hostname -I | awk '{print $1}')"
    echo "uptime  : $(uptime -p 2>/dev/null)"
    for s in dump1090-fa dump1090-json skyview skyview-update.timer skyview-selfheal.timer; do
      printf "%-24s %s\n" "$s" "$(systemctl is-active "$s" 2>/dev/null)"
    done
    curl -fsS http://localhost:3000/api/health >/dev/null 2>&1 \
      && echo "server  : OK" || echo "server  : DOWN"
    f="$(feed)"
    if [ -n "$f" ]; then
      n=$(printf '%s' "$f" | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("aircraft",[])))' 2>/dev/null || echo "?")
      echo "decoder : OK ($n aircraft now)"
    else
      echo "decoder : DOWN"
    fi
    echo "version : $(cat /var/lib/skyview/version 2>/dev/null || echo '(unset)')"
    echo "overlay : $(grep -q 'boot=overlay' /proc/cmdline 2>/dev/null && echo 'sealed (read-only)' || echo 'writable')"
    ;;
  logs)
    svc="${2:-skyview}"; journalctl -u "$svc" -n 100 --no-pager ;;
  restart)
    sudo systemctl restart dump1090-fa dump1090-json skyview; echo "restarted." ;;
  ip)
    hostname -I | awk '{print $1}' ;;
  health)
    curl -s http://localhost:3000/api/health; echo ;;
  update)
    if [ "${2:-}" = "now" ]; then
      sudo systemctl start skyview-update.service \
        && journalctl -u skyview-update -n 20 --no-pager
    else
      echo "usage: skyview update now"
    fi ;;
  auto)
    case "${2:-status}" in
      on)  sudo systemctl enable --now skyview-update.timer; echo "auto-update on." ;;
      off) sudo systemctl disable --now skyview-update.timer; echo "auto-update off." ;;
      *)
        systemctl is-active skyview-update.timer >/dev/null 2>&1 && echo "auto-update: on" || echo "auto-update: off"
        echo "channel : $(grep -E '^CHANNEL=' /etc/skyview/update.conf 2>/dev/null | cut -d= -f2 || echo '?')"
        systemctl list-timers skyview-update.timer --no-pager 2>/dev/null | sed -n 2p ;;
    esac ;;
  wifi)
    ssid="${2:-}"; pass="${3:-}"
    { [ -z "$ssid" ] || [ -z "$pass" ]; } && { echo 'usage: skyview wifi "<ssid>" "<password>"'; exit 1; }
    sudo nmcli con delete "SkyView" 2>/dev/null || true
    sudo nmcli con add type wifi ifname wlan0 con-name "SkyView" ssid "$ssid"
    sudo nmcli con modify "SkyView" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$pass" connection.autoconnect yes
    sudo nmcli con up "SkyView" && echo "joined $ssid" || echo "join failed; check the password"
    sleep 3; exec "$0" status ;;
  seal)
    sudo /usr/local/bin/skyview-harden --seal ;;
  unseal)
    sudo /usr/local/bin/skyview-harden --unseal ;;
  switch)
    # skyview switch v1|v2|status — flip active version (v2 primary, v1 baseline)
    exec /usr/local/bin/skyview-switch "${2:-status}" ;;
  rollback)
    # convenience: jump straight back to the v1 baseline
    exec /usr/local/bin/skyview-switch v1 ;;
  *)
    echo "usage: skyview {status|logs [service]|restart|update now|auto [on|off]|health|ip|wifi \"<ssid>\" \"<pass>\"|seal|unseal|switch v1|v2|rollback}"; exit 1 ;;
esac
