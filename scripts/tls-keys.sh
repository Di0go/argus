#!/usr/bin/env bash
# The key log that lets Argus read this PC's own HTTPS (docs/requests.md): on, off, or how it is.
#
#   scripts/tls-keys.sh status
#   scripts/tls-keys.sh on      then log out of the session and back in
#   scripts/tls-keys.sh off     then log out and back in; the keys written so far are deleted
#
# "on" writes ~/.config/environment.d/90-argus-tls-keys.conf with one line: SSLKEYLOGFILE in $XDG_RUNTIME_DIR. The
# session's programs get it at the next login (KDE starts them from the systemd user manager, which reads that
# folder), and so does argus.service. Firefox, Chromium and curl then write each TLS session's keys to that file, and
# Argus has tshark read it: their HTTPS shows on the Requests page, method, address, headers and answer.
#
# What it means: whoever reads that file, with a capture of the same minutes, reads everything those programs sent
# and received over HTTPS, passwords, cookies and pages. So it is kept where nothing else looks: $XDG_RUNTIME_DIR is
# this user's alone (700), in memory, and gone at logout or shutdown; captures saved by Argus do not carry the keys.
# Nothing runs as root, and nothing is sent anywhere. Other devices' HTTPS stays encrypted whatever is done here.

set -euo pipefail

CONF="${XDG_CONFIG_HOME:-$HOME/.config}/environment.d/90-argus-tls-keys.conf"
RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
KEYS="$RUNTIME/tls-keys.log"

case "${1:-status}" in
  on)
    mkdir -p "$(dirname "$CONF")"
    cat > "$CONF" <<'EOF'
# Argus (scripts/tls-keys.sh): the browsers and curl write their TLS keys here, so Argus reads this PC's own HTTPS.
# Whoever reads the file can decrypt what they sent. In memory, this user's only, gone at logout. Remove to stop.
SSLKEYLOGFILE=${XDG_RUNTIME_DIR}/tls-keys.log
EOF
    echo "Written: $CONF"
    echo "Next: log out of the session and back in (the programs open now do not see it)."
    echo "Then, if argus.service did not restart with the session: systemctl --user restart argus"
    echo "Check: open a page in Firefox, then: $0 status"
    ;;
  off)
    rm -f "$CONF"
    rm -f "$KEYS"
    echo "Removed $CONF and the keys in $KEYS."
    echo "Programs started before still have the variable until you log out and back in."
    ;;
  status)
    if [[ -f "$CONF" ]]; then echo "On: $CONF"; else echo "Off: no $CONF"; fi
    if [[ -n "${SSLKEYLOGFILE:-}" ]]; then echo "This shell has SSLKEYLOGFILE=$SSLKEYLOGFILE"; else echo "This shell has no SSLKEYLOGFILE (a new login gives it)"; fi
    if [[ -f "$KEYS" ]]; then echo "Keys: $KEYS, $(wc -l < "$KEYS") lines, last written $(date -r "$KEYS" '+%H:%M:%S')"; else echo "Keys: none yet in $KEYS"; fi
    ;;
  *)
    echo "Usage: $0 on|off|status" >&2
    exit 2
    ;;
esac
