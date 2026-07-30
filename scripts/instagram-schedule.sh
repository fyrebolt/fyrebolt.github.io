#!/bin/bash
# ===== Schedule the daily Instagram pull with launchd =====
#
# Generates a LaunchAgent that runs scripts/instagram-pull.mjs once a day from
# this machine (your home IP — datacenter IPs get challenged by Instagram).
# Absolute paths to node and the repo are baked in at install time, because
# launchd runs with a minimal PATH.
#
#   ./scripts/instagram-schedule.sh install [HH:MM]   # default 09:20
#   ./scripts/instagram-schedule.sh status
#   ./scripts/instagram-schedule.sh run               # trigger one run now
#   ./scripts/instagram-schedule.sh logs
#   ./scripts/instagram-schedule.sh uninstall
set -euo pipefail

LABEL="com.fyrebolt.instagram-tracker"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/instagram-tracker.log"
ACTION="${1:-status}"

case "$ACTION" in
install)
  AT="${2:-09:20}"
  HOUR="${AT%%:*}"
  MINUTE="${AT##*:}"
  NODE="$(command -v node || true)"
  if [ -z "$NODE" ]; then
    echo "✗ node not found on PATH — install Node 18+ first." >&2
    exit 1
  fi
  if [ ! -f "$REPO/scripts/.instagram-secrets.json" ]; then
    echo "⚠ scripts/.instagram-secrets.json doesn't exist yet."
    echo "  The job will install, but it'll fail until you create it. See the README."
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
  cat >"$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/scripts/instagram-pull.mjs</string>
    <string>--commit</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$((10#$HOUR))</integer>
    <key>Minute</key><integer>$((10#$MINUTE))</integer>
  </dict>
  <!-- Don't fire on install/login; only on the calendar interval above. launchd
       provides the catch-up on its own: a run missed because the Mac was asleep
       fires once the machine wakes. -->
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLISTEOF

  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "✓ Scheduled daily at $AT"
  echo "  plist: $PLIST"
  echo "  log:   $LOG"
  echo "  node:  $NODE"
  ;;

uninstall)
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ Removed $LABEL"
  ;;

status)
  if launchctl list | grep -q "$LABEL"; then
    echo "✓ $LABEL is loaded"
    launchctl list "$LABEL" | grep -E 'LastExitStatus|PID' || true
  else
    echo "✗ $LABEL is not loaded — run: ./scripts/instagram-schedule.sh install"
  fi
  [ -f "$LOG" ] && echo "  log: $LOG ($(wc -l <"$LOG" | tr -d ' ') lines)"
  ;;

run)
  launchctl start "$LABEL"
  echo "✓ Triggered. Watch it with: ./scripts/instagram-schedule.sh logs"
  ;;

logs)
  tail -n 40 -f "$LOG"
  ;;

*)
  echo "usage: $0 {install [HH:MM]|uninstall|status|run|logs}" >&2
  exit 1
  ;;
esac
