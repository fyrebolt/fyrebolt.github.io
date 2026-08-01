#!/bin/bash
# ===== Schedule the daily LinkedIn pull with launchd =====
#
# Generates a LaunchAgent that runs scripts/linkedin-pull.mjs once a day from
# this machine (your home IP — datacenter IPs get challenged by LinkedIn).
# Absolute paths to node and the repo are baked in at install time, because
# launchd runs with a minimal PATH.
#
#   ./scripts/linkedin-schedule.sh install [HH:MM]   # default 09:40
#   ./scripts/linkedin-schedule.sh status
#   ./scripts/linkedin-schedule.sh run               # trigger one run now
#   ./scripts/linkedin-schedule.sh logs
#   ./scripts/linkedin-schedule.sh uninstall
#
# Running daily matters more here than it does for the Instagram tracker: a
# follower you miss today is still there tomorrow, but LinkedIn drops profile
# viewers off the list after a few days, so a week of missed runs is a week of
# viewers you can never recover.
set -euo pipefail

LABEL="com.fyrebolt.linkedin-tracker"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/linkedin-tracker.log"
SECRETS="$REPO/scripts/.linkedin-secrets.json"
ACTION="${1:-status}"

case "$ACTION" in
install)
  # Offset from the Instagram job's default so two scrapers don't start in the
  # same minute and share a burst of outbound traffic.
  AT="${2:-09:40}"
  HOUR="${AT%%:*}"
  MINUTE="${AT##*:}"
  NODE="$(command -v node || true)"
  if [ -z "$NODE" ]; then
    echo "✗ node not found on PATH — install Node 18+ first." >&2
    exit 1
  fi
  if [ ! -f "$SECRETS" ]; then
    echo "⚠ scripts/.linkedin-secrets.json doesn't exist yet."
    echo "  The job will install, but it'll fail until you create it. See the README."
  fi

  # Fire every hour from the chosen time until midnight. The script itself is
  # the guard: with --once-daily it no-ops as soon as a run has succeeded today,
  # so these are retries, not repeats. A Mac that was asleep at 09:40 still gets
  # its pull at 10:40, or whenever it next wakes.
  INTERVALS=""
  for H in $(seq "$((10#$HOUR))" 23); do
    INTERVALS="$INTERVALS
    <dict><key>Hour</key><integer>$H</integer><key>Minute</key><integer>$((10#$MINUTE))</integer></dict>"
  done
  ATTEMPTS=$((24 - 10#$HOUR))

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
    <string>$REPO/scripts/linkedin-pull.mjs</string>
    <string>--commit</string>
    <string>--once-daily</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>StartCalendarInterval</key>
  <array>$INTERVALS
  </array>
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
  echo "✓ First attempt at $AT, then hourly until midnight ($ATTEMPTS attempts)"
  echo "  It stops as soon as one succeeds — at most one real pull per day."
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
  # Query the label directly. Piping `launchctl list` into `grep -q` looks
  # equivalent but isn't: grep closes the pipe on its first match, launchctl
  # takes SIGPIPE, and `set -o pipefail` turns that into a failed check —
  # reporting the job as missing while it's running perfectly well.
  if launchctl list "$LABEL" >/dev/null 2>&1; then
    echo "✓ $LABEL is loaded"
    launchctl list "$LABEL" | grep -E 'LastExitStatus|PID' || true
  else
    echo "✗ $LABEL is not loaded — run: ./scripts/linkedin-schedule.sh install"
  fi
  [ -f "$LOG" ] && echo "  log: $LOG ($(wc -l <"$LOG" | tr -d ' ') lines)"
  # The question you actually care about: is today's data in?
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const day = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    let h; try { h = JSON.parse(fs.readFileSync(p, "utf8")); } catch { console.log("  ✗ no history.json yet"); process.exit(0); }
    if (h.sample) { console.log("  ✗ still showing sample data — no real pull yet"); process.exit(0); }
    const t = new Date(h.generatedAt);
    const done = day(t) === day(new Date());
    const hrs = ((Date.now() - t.getTime()) / 3.6e6).toFixed(1);
    console.log(done
      ? `  ✓ today’s pull is done (${t.toLocaleTimeString()}) — further attempts today will no-op`
      : `  ⏳ today’s pull has NOT run yet (last was ${hrs}h ago) — it will retry on the hour`);
    console.log(`     connections ${h.connections?.length ?? "?"} · followers ${h.followers?.length ?? "?"} · ${h.views?.length ?? 0} views logged`);
  ' "$REPO/scripts/.linkedin-private.json" 2>/dev/null \
    || node -e 'console.log("  (no private log yet)")' 2>/dev/null || true
  ;;

run)
  launchctl start "$LABEL"
  echo "✓ Triggered. Watch it with: ./scripts/linkedin-schedule.sh logs"
  ;;

logs)
  tail -n 40 -f "$LOG"
  ;;

*)
  echo "usage: $0 {install [HH:MM]|uninstall|status|run|logs}" >&2
  exit 1
  ;;
esac
