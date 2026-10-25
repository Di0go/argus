#!/usr/bin/env bash
# What Argus needs root for, all at once (one pkexec):
#
#   pkexec bash "$PWD/scripts/install-capture.sh"        (from Argus's folder; pkexec wants the full path)
#
# 1. Installs wireshark-cli (tshark, dumpcap) with pacman. Only that package, without -y: it does not upgrade the
#    system halfway.
# 2. Capture without root. Argus never runs as root: only dumpcap touches the network card, and tshark reads the file
#    it writes. Arch's package already leaves dumpcap like this:
#      - owner root:wireshark, mode 754: only root and the wireshark group may run it;
#      - capabilities cap_net_raw,cap_net_admin,cap_dac_override+eip (post_install runs setcap): it opens the card for
#        capture without being root. There is no setuid.
#    What this script adds:
#      - puts the user in the wireshark group (what lasts);
#      - also gives them, by ACL, the right to run dumpcap (setfacl u:<user>:rx), because the new group only reaches
#        sessions after logging out and in again, and long-running terminal sessions are not restarted. An upgrade
#        of wireshark-cli replaces the file and the ACL goes with it; by then the group counts.
#      - checks the capabilities, and puts them back if they are missing (a file system without xattrs loses them).
#    What it does not do: monitor mode, or anything that touches other people's traffic. Argus only listens.
# 3. The address https://argus.test, through the core's script (@organon/core, setup-hostname.sh): /etc/hosts with
#    argus.test at 127.0.0.84, the nft rule taking 127.0.0.84:80 and :443 to 127.0.0.1:4930 and :4931, the
#    argus-nome.service unit that loads it at boot, and Argus's certificate authority (limited to argus.test, made
#    before by tls.sh, without root) in the system's trust store.
#
# Before, as the user (without root): pnpm install and pnpm tls in Argus. The script checks that before changing
# anything. It can be run again without breaking anything.
#
# To undo: gpasswd -d <user> wireshark; setfacl -x u:<user> /usr/bin/dumpcap; pacman -R wireshark-cli; and what the
# core's setup-hostname.sh says in its header.
set -euo pipefail

# Argus's folder, from the script itself (pkexec does not keep the folder it was called from).
ROOT=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)
CORE_SCRIPTS="$ROOT/node_modules/@organon/core/scripts"

if [[ $EUID -ne 0 ]]; then
  echo "Run it as root: pkexec bash $ROOT/scripts/install-capture.sh" >&2
  exit 1
fi

# Who asked: the user who called pkexec (or the folder's owner, with sudo or as root by hand).
USER_NAME=$(id -nu "${PKEXEC_UID:-$(stat -c %u "$ROOT")}")
if [[ "$USER_NAME" == root ]]; then
  echo "Cannot tell which user the capture is for; run it with pkexec from your own session." >&2
  exit 1
fi

# Everything that has to exist before anything changes.
for f in "$CORE_SCRIPTS/setup-hostname.sh" "$ROOT/.argus/tls/ca.crt"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f: first run, as $USER_NAME, in Argus: pnpm install && pnpm tls" >&2
    exit 1
  fi
done

echo "== 1. wireshark-cli"
pacman -S --needed --noconfirm wireshark-cli

echo "== 2. capture without root for $USER_NAME"
DUMPCAP=/usr/bin/dumpcap
getent group wireshark >/dev/null || { echo "The package did not create the wireshark group." >&2; exit 1; }
usermod -aG wireshark "$USER_NAME"
setfacl -m "u:$USER_NAME:rx" "$DUMPCAP"
if ! getcap "$DUMPCAP" | grep -q cap_net_raw; then
  setcap cap_net_raw,cap_net_admin,cap_dac_override+eip "$DUMPCAP"
fi
echo "dumpcap: $(stat -c '%U:%G %a' "$DUMPCAP"), $(getcap "$DUMPCAP" | cut -d' ' -f2-)"
# The proof: the user lists the interfaces without root (dumpcap only lists them if it can open the capture).
runuser -u "$USER_NAME" -- "$DUMPCAP" -D | head -20

echo "== 3. https://argus.test"
bash "$CORE_SCRIPTS/setup-hostname.sh" "$ROOT"

echo
echo "Done. The wireshark group reaches new sessions; until then the ACL is enough. Argus: pnpm app restart."
