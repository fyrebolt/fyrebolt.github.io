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
#
# The "Update now" button in the app needs a second, always-on agent:
#   ./scripts/instagram-schedule.sh agent-install
#   ./scripts/instagram-schedule.sh agent-status | agent-logs | agent-uninstall
set -euo pipefail

LABEL="com.fyrebolt.instagram-tracker"
AGENT_LABEL="com.fyrebolt.instagram-agent"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
LOG="$HOME/Library/Logs/instagram-tracker.log"
AGENT_LOG="$HOME/Library/Logs/instagram-agent.log"
SECRETS="$REPO/scripts/.instagram-secrets.json"
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

  # Fire every hour from the chosen time until midnight. The script itself is
  # the guard: with --once-daily it no-ops as soon as a run has succeeded today,
  # so these are retries, not repeats. A Mac that was asleep at 09:20 still gets
  # its pull at 10:20, or whenever it next wakes.
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
    <string>$REPO/scripts/instagram-pull.mjs</string>
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
    echo "✗ $LABEL is not loaded — run: ./scripts/instagram-schedule.sh install"
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
    console.log(`     followers ${h.followers?.length ?? "?"} · following ${h.following?.length ?? "?"}`);
  ' "$REPO/public/instagram/history.json" 2>/dev/null || true
  ;;

run)
  launchctl start "$LABEL"
  echo "✓ Triggered. Watch it with: ./scripts/instagram-schedule.sh logs"
  ;;

logs)
  tail -n 40 -f "$LOG"
  ;;

agent-install)
  NODE="$(command -v node || true)"
  if [ -z "$NODE" ]; then
    echo "✗ node not found on PATH — install Node 18+ first." >&2
    exit 1
  fi
  if [ ! -f "$SECRETS" ]; then
    echo "✗ $SECRETS not found. Set up the daily pull first." >&2
    exit 1
  fi

  # The agent refuses to start without a strong token; mint one if absent so
  # there's no weak-password step for the user to get wrong.
  if ! /usr/bin/grep -q '"agentToken"' "$SECRETS"; then
    TOKEN="$("$NODE" -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")"
    "$NODE" -e "
      const fs=require('fs'), p=process.argv[1], t=process.argv[2];
      const d=JSON.parse(fs.readFileSync(p,'utf8'));
      d.agentToken=t;
      fs.writeFileSync(p, JSON.stringify(d,null,2)+'\n');
    " "$SECRETS" "$TOKEN"
    echo "✓ Generated an agent passphrase and saved it to scripts/.instagram-secrets.json"
    echo
    echo "  Copy this into the app the first time you press “Update now”:"
    echo
    echo "      $TOKEN"
    echo
  else
    echo "ℹ An agentToken already exists. Read it with:"
    echo "      node -e \"console.log(require('./scripts/.instagram-secrets.json').agentToken)\""
    echo
  fi

  mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$AGENT_LOG")"
  cat >"$AGENT_PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$REPO/scripts/instagram-agent.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <!-- Long-running listener: start at login and restart if it ever dies. -->
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$AGENT_LOG</string>
  <key>StandardErrorPath</key><string>$AGENT_LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLISTEOF

  launchctl unload "$AGENT_PLIST" 2>/dev/null || true
  launchctl load "$AGENT_PLIST"
  sleep 1
  if /usr/bin/curl -sf -m 3 http://127.0.0.1:4599/health >/dev/null; then
    echo "✓ Agent running on http://127.0.0.1:4599 (loopback only)"
  else
    echo "⚠ Agent loaded but not answering yet — check: $AGENT_LOG"
  fi
  ;;

agent-uninstall)
  launchctl unload "$AGENT_PLIST" 2>/dev/null || true
  rm -f "$AGENT_PLIST"
  echo "✓ Removed $AGENT_LABEL (the Update now button will disappear)"
  ;;

agent-status)
  # Direct label query — see the note under `status` for why not `| grep -q`.
  if launchctl list "$AGENT_LABEL" >/dev/null 2>&1; then
    echo "✓ $AGENT_LABEL is loaded"
  else
    echo "✗ $AGENT_LABEL is not loaded — run: $0 agent-install"
  fi
  if /usr/bin/curl -sf -m 3 http://127.0.0.1:4599/health >/dev/null; then
    echo "✓ answering on http://127.0.0.1:4599"
  else
    echo "✗ not answering on 127.0.0.1:4599"
  fi
  ;;

agent-logs)
  tail -n 40 -f "$AGENT_LOG"
  ;;

*)
  echo "usage: $0 {install [HH:MM]|uninstall|status|run|logs}" >&2
  echo "       $0 {agent-install|agent-uninstall|agent-status|agent-logs}" >&2
  exit 1
  ;;
esac
