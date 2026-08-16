# justin06lee-mcp — build the binary, install it, register it with Otto.
#
#   make          build → install → verify credentials → register with Otto
#   make build    produce the native binary in dist/ only
#   make install  same golden path as `make`
#   make update   reinstall, then kick Otto so it respawns the new binary

.PHONY: all build install update check deploy

all: install

build:
	bun run build

install:
	./install.sh

# A stdio MCP server has no daemon of its own: install.sh already builds to a
# temp file and moves it into place, so nothing holds the old binary. The only
# thing to restart is Otto, which respawns the server per session.
update: install
	-@launchctl kickstart -k gui/$$UID/com.otto.bot 2>/dev/null \
		|| systemctl --user restart otto 2>/dev/null \
		|| echo "    (no local Otto to restart)"

check:
	bun run check

# Cross-compile for the tenet box, ship it, doctor it there, restart Otto.
deploy:
	./scripts/deploy.sh
