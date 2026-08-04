# @justin06lee/mcp

MCP server for changing [justin06lee.dev](https://justin06lee.dev) without touching code.

Portfolio items, homepage bio and socials, calendar plans, categories, and time
tracking — 22 tools over the site's existing HTTP API.

---

## why it wraps HTTP and not the database

Every justin06lee.dev site shares one Turso database, so talking to it directly
is tempting. This server deliberately doesn't:

- The API routes own validation and the category/plan foreign-key checks.
- They call `revalidatePath()`. A direct database write changes the data and
  leaves the site serving a **stale cached page**.
- Anything the API can do, curl and cron can do too. Keeping the logic there
  means MCP is a thin wrapper, not the only way in.

The server holds one credential — `ADMIN_KEY` — and exchanges it for a session
cookie, because the site has no header-token auth path.

## it is not a daemon

Worth being explicit, because it's the thing most people get wrong: an MCP
stdio server is **not** a long-running service. The agent spawns it as a child
process and talks over stdin/stdout, the same way Otto already spawns
`otto-memory`. There is nothing to keep alive, no port, no tmux window, no
systemd unit.

The unit of deployment is a **binary in `~/.local/bin`** plus one entry in
`~/.config/otto/mcp.json`. That is the whole install.

Running it by hand just makes it sit there waiting for JSON-RPC on stdin. To
check it actually works, use `--doctor`.

## install

```bash
./install.sh
```

Idempotent — re-run to rebuild, rotate the key, or repair the registration. It
builds a self-contained binary into `~/.local/bin/justin06lee-mcp`, verifies the
credentials against the live site, and only then merges itself into Otto's
`mcp.json` (leaving the other servers alone, `0600`).

Then restart Otto:

```bash
systemctl --user restart otto              # Arch
launchctl kickstart -k gui/$UID/com.otto.bot   # macOS
```

> **Otto's `setup.sh` rewrites `mcp.json` from scratch** and will drop this
> entry. If you re-run it, re-run `./install.sh` afterwards.

### checking it works

```bash
justin06lee-mcp --doctor
```

Hits the live site and reports auth, items, config, categories, and timers.
Non-zero exit on failure, so it works in a health check.

### other agents

Nothing here is Otto-specific — it's a standard MCP stdio server:

```bash
claude mcp add justin06lee \
  --env ADMIN_KEY=... --env SITE_URL=https://justin06lee.dev \
  -- ~/.local/bin/justin06lee-mcp
```

## configuration

All configuration is environment variables — nothing is read from disk, no path
is baked into the build. That is what makes the same artifact run from a laptop,
a systemd unit, or a container.

| variable | default | notes |
|---|---|---|
| `SITE_URL` | `https://justin06lee.dev` | Which deployment to control. Point at `http://localhost:3000` to test against a dev database. |
| `ADMIN_KEY` | *(required)* | Same key the target site is deployed with. Grants full admin. |
| `REQUEST_TIMEOUT_MS` | `15000` | Raise if the site cold-starts slowly. |

## deploying to the Arch box

The binary embeds its own runtime, so the target machine needs **neither Node
nor Bun** — nothing to install, nothing to keep in sync.

Build here, copy across:

```bash
./install.sh --target linux-x64     # → dist/justin06lee-mcp-linux-x64
scp dist/justin06lee-mcp-linux-x64 arch:~/.local/bin/justin06lee-mcp
```

Then on the Arch box:

```bash
chmod +x ~/.local/bin/justin06lee-mcp
ADMIN_KEY=... justin06lee-mcp --doctor      # confirm before registering
./install.sh --no-register                  # or register by hand in mcp.json
systemctl --user restart otto
```

Or just run `./install.sh` there if the repo is checked out and Bun is present.

Cross-compiled output deliberately stays in `dist/` rather than
`~/.local/bin` — installing a foreign-arch binary over the working one would
break the local agent.

## tools

| area | tools |
|---|---|
| Portfolio items | `list_items` `create_item` `update_item` `move_item` `delete_item` |
| Site config | `get_site_config` `update_site_config` |
| Calendar plans | `list_calendar_tasks` `create_calendar_task` `update_calendar_task` `delete_calendar_task` |
| Categories | `list_calendar_categories` `create_calendar_category` `update_calendar_category` `delete_calendar_category` |
| Time tracking | `get_running_timers` `start_timer` `stop_timer` `list_time_entries` `create_time_entry` `update_time_entry` `delete_time_entry` |

Two places where the tool is friendlier than the raw endpoint:

- **`update_item` is a real partial update.** The site's `PUT /api/items/:id` is
  a full replace that nulls any omitted column. The tool reads the current row
  and merges, so a one-field change stays a one-field change.
- **`get_running_timers` always returns a list.** The bare endpoint returns
  `204` with no body when nothing is running, which reads as a failure.

## layout

```
install.sh            # build → ~/.local/bin → register with Otto
src/
├── index.ts          # entry: stdio transport, --doctor, --version
├── doctor.ts         # live connectivity + auth check
├── server.ts         # builds the server, registers tools — no transport
├── config.ts         # environment parsing
├── client.ts         # HTTP client: cookie session, retry, timeouts
└── tools/
    ├── shared.ts     # validation limits mirrored from the site
    ├── items.ts
    ├── site-config.ts
    ├── calendar.ts
    └── timers.ts
scripts/smoke.ts      # boots the built server over stdio, asserts the manifest
```

`server.ts` binds no transport. If a genuinely remote setup is ever wanted —
the agent on one machine, the server on another — that means adding an entry
point beside `index.ts` and no tool code changes. Until then, stdio is simpler
and has no listening port to secure.

## not covered

- **`/api/pats`** — deliberately excluded. It's a head-pat counter, not
  configuration.
- **coffee.justin06lee.dev** — event types, availability, and bookings live
  behind `"use server"` actions with no HTTP routes, so nothing external can
  reach them yet. Adding routes there is a prerequisite.
- **dojo / listen / oddjob / lab** — no database. Their content is hardcoded in
  JSX, so there is nothing for a tool to change until it's moved into the DB.
