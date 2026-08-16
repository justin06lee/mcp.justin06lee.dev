#!/usr/bin/env bash
#
# Cross-compile for the tenet box, ship the binary, verify it there with the
# env Otto already has registered, and restart Otto. Replaces the manual
# build → scp → chmod → doctor → restart sequence.
#
#   ./scripts/deploy.sh                # deploy to justin06lee@tenet
#   REMOTE=user@host ./scripts/deploy.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${REMOTE:-justin06lee@tenet}"
BIN_NAME="justin06lee-mcp"

./install.sh --target linux-x64

echo "==> shipping to $REMOTE"
scp "dist/$BIN_NAME-linux-x64" "$REMOTE:.local/bin/$BIN_NAME.new"

# Swap into place remotely, then doctor with the registered env — a binary
# that can't authenticate should be caught here, not inside Telegram.
ssh "$REMOTE" bash -s <<'REMOTE_SCRIPT'
set -euo pipefail
BIN="$HOME/.local/bin/justin06lee-mcp"
chmod +x "$BIN.new"
mv "$BIN.new" "$BIN"
echo "==> installed $($BIN --version) on $(uname -n)"

eval "$(python3 - <<'PY'
import json, os, shlex
path = os.path.expanduser("~/.config/otto/mcp.json")
env = json.load(open(path))["mcpServers"]["justin06lee"]["env"]
for key, value in env.items():
    print(f"export {key}={shlex.quote(value)}")
PY
)"
"$BIN" --doctor

systemctl --user restart otto
systemctl --user is-active otto
REMOTE_SCRIPT

echo
echo "Deployed. Otto restarted and running against the new binary."
