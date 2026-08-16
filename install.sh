#!/usr/bin/env bash
#
# Builds justin06lee-mcp into ~/.local/bin and registers it with Otto.
#
# Idempotent — re-run anytime to rebuild, rotate the key, or repair the
# registration. Mirrors Otto's own setup.sh conventions (binary in
# ~/.local/bin, config in ~/.config/otto, 0600 on anything holding a secret).
#
#   ./install.sh                      build native, install, register
#   ./install.sh --target linux-x64   cross-compile for the Arch box
#   ./install.sh --no-register        install the binary only
#
set -euo pipefail

BIN_NAME="justin06lee-mcp"
BIN_DIR="$HOME/.local/bin"
OTTO_CONFIG_DIR="$HOME/.config/otto"
MCP_FILE="$OTTO_CONFIG_DIR/mcp.json"
SERVER_KEY="justin06lee"

TARGET=""
REGISTER=true
OUT_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --target)      TARGET="${2:?--target needs a value, e.g. linux-x64}"; shift 2 ;;
    --no-register) REGISTER=false; shift ;;
    --out)         OUT_DIR="${2:?--out needs a directory}"; shift 2 ;;
    -h|--help)     sed -n '3,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

cd "$(dirname "$0")"

command -v bun >/dev/null 2>&1 || {
  echo "bun is required to build. https://bun.sh" >&2
  exit 1
}

# ── Build ────────────────────────────────────────────────────────────────────
# A compiled binary rather than a JS bundle: it embeds its own runtime, so a
# minimal Arch box needs neither Node nor Bun installed to run it.

[ -d node_modules ] || bun install --frozen-lockfile

if [ -n "$TARGET" ]; then
  # Cross-compiled output stays out of ~/.local/bin — it can't run on this
  # machine, and silently installing a foreign-arch binary over the working
  # one would break the local agent.
  OUT_DIR="${OUT_DIR:-dist}"
  mkdir -p "$OUT_DIR"
  OUT="$OUT_DIR/$BIN_NAME-$TARGET"
  echo "==> building for bun-$TARGET"
  bun build src/index.ts --compile --minify --target="bun-$TARGET" --outfile "$OUT"
  echo
  echo "Built $OUT ($(du -h "$OUT" | cut -f1))."
  echo "Copy it to the target machine's ~/.local/bin/$BIN_NAME, then run:"
  echo "  ADMIN_KEY=... $BIN_NAME --doctor"
  exit 0
fi

echo "==> building $BIN_NAME"
mkdir -p "$BIN_DIR"
# Build to a temp path and move into place: overwriting a running binary in
# situ can fail with ETXTBSY while an agent has it spawned.
TMP_BIN="$(mktemp -t "$BIN_NAME.XXXXXX")"
trap 'rm -f "$TMP_BIN"' EXIT
bun build src/index.ts --compile --minify --outfile "$TMP_BIN"
install -m 755 "$TMP_BIN" "$BIN_DIR/$BIN_NAME"
echo "    installed $BIN_DIR/$BIN_NAME ($(du -h "$BIN_DIR/$BIN_NAME" | cut -f1))"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "    note: $BIN_DIR is not on PATH" ;;
esac

[ "$REGISTER" = true ] || exit 0

# ── Credentials ──────────────────────────────────────────────────────────────
SITE_URL="${SITE_URL:-https://justin06lee.dev}"
ADMIN_KEY="${ADMIN_KEY:-}"

# Reuse the key already in mcp.json so re-running doesn't re-prompt.
if [ -z "$ADMIN_KEY" ] && [ -f "$MCP_FILE" ]; then
  ADMIN_KEY="$(MCP_FILE="$MCP_FILE" SERVER_KEY="$SERVER_KEY" python3 - <<'PY'
import json, os
try:
    with open(os.environ["MCP_FILE"]) as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
env = cfg.get("mcpServers", {}).get(os.environ["SERVER_KEY"], {}).get("env", {})
print(env.get("ADMIN_KEY", ""), end="")
PY
)"
  [ -n "$ADMIN_KEY" ] && echo "    reusing ADMIN_KEY from $MCP_FILE"
fi

if [ -z "$ADMIN_KEY" ]; then
  if [ ! -t 0 ]; then
    echo "ADMIN_KEY not set and stdin is not a terminal. Pass it in the environment." >&2
    exit 1
  fi
  read -rsp "ADMIN_KEY for $SITE_URL: " ADMIN_KEY
  echo
  [ -n "$ADMIN_KEY" ] || { echo "empty key, aborting" >&2; exit 1; }
fi

# ── Verify before registering ────────────────────────────────────────────────
# Registering a server that can't authenticate just moves the failure into
# Telegram, where it's far harder to read.
echo "==> checking credentials against $SITE_URL"
if ! SITE_URL="$SITE_URL" ADMIN_KEY="$ADMIN_KEY" "$BIN_DIR/$BIN_NAME" --doctor; then
  echo
  echo "Doctor failed — not registering. Fix the above and re-run." >&2
  exit 1
fi

# ── Register with Otto ───────────────────────────────────────────────────────
# Merge into mcp.json rather than rewriting it, so the other servers survive.
mkdir -p "$OTTO_CONFIG_DIR"
[ -f "$MCP_FILE" ] || install -m 600 /dev/null "$MCP_FILE"

MCP_FILE="$MCP_FILE" SERVER_KEY="$SERVER_KEY" BIN_PATH="$BIN_DIR/$BIN_NAME" \
SITE_URL="$SITE_URL" ADMIN_KEY="$ADMIN_KEY" \
TRUMAN_URL="${TRUMAN_URL:-}" TRUMAN_OWNER_KEY="${TRUMAN_OWNER_KEY:-}" \
LISTEN_URL="${LISTEN_URL:-}" LISTEN_OWNER_KEY="${LISTEN_OWNER_KEY:-}" \
REQUEST_TIMEOUT_MS="${REQUEST_TIMEOUT_MS:-}" python3 - <<'PY'
import json, os, tempfile

path = os.environ["MCP_FILE"]
try:
    with open(path) as f:
        cfg = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    cfg = {}

servers = cfg.setdefault("mcpServers", {})
# Merge over the existing entry so optional keys registered earlier (truman,
# listen, timeouts) survive a re-run that doesn't have them in its environment.
env = servers.get(os.environ["SERVER_KEY"], {}).get("env", {})
env["SITE_URL"] = os.environ["SITE_URL"]
env["ADMIN_KEY"] = os.environ["ADMIN_KEY"]
for key in ("TRUMAN_URL", "TRUMAN_OWNER_KEY", "LISTEN_URL", "LISTEN_OWNER_KEY", "REQUEST_TIMEOUT_MS"):
    if os.environ.get(key):
        env[key] = os.environ[key]

servers[os.environ["SERVER_KEY"]] = {
    "command": os.environ["BIN_PATH"],
    "env": env,
}

# Write via a temp file in the same directory so an interrupted run can't
# leave mcp.json truncated — that would take every other MCP server down too.
d = os.path.dirname(path)
fd, tmp = tempfile.mkstemp(dir=d)
try:
    with os.fdopen(fd, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
except BaseException:
    os.unlink(tmp)
    raise
PY

echo "    registered \"$SERVER_KEY\" in $MCP_FILE"

echo
echo "Done. Restart Otto to pick it up:"
if [ "$(uname -s)" = "Darwin" ]; then
  echo "  launchctl kickstart -k gui/\$UID/com.otto.bot"
else
  echo "  systemctl --user restart otto"
fi
echo
echo "Heads up: Otto's own setup.sh rewrites mcp.json from scratch, which drops"
echo "this entry. If you re-run it, re-run this script afterwards."
