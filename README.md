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

## setup

```bash
bun install
cp .env.example .env    # set ADMIN_KEY
bun run check           # typecheck + smoke test
bun run build
```

### wire it into Claude Code

```bash
claude mcp add justin06lee \
  --env ADMIN_KEY=... \
  --env SITE_URL=https://justin06lee.dev \
  -- node /absolute/path/to/dist/index.js
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "justin06lee": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": { "ADMIN_KEY": "...", "SITE_URL": "https://justin06lee.dev" }
    }
  }
}
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

## deploying to the home server

The build is one file with no runtime dependencies beyond Node.

**Docker** — stdio needs `-i`, so stdin stays attached:

```bash
docker build -t justin06lee-mcp .
docker run -i --rm --env-file .env justin06lee-mcp
```

**Plain Node** — copy `dist/index.js` across and run it with the env set. No
`node_modules`, no source, no install step.

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
src/
├── index.ts          # stdio entry point
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

`server.ts` binds no transport. Serving this over HTTP from the home server
later means adding an entry point beside `index.ts` — no tool code changes.

## not covered

- **`/api/pats`** — deliberately excluded. It's a head-pat counter, not
  configuration.
- **coffee.justin06lee.dev** — event types, availability, and bookings live
  behind `"use server"` actions with no HTTP routes, so nothing external can
  reach them yet. Adding routes there is a prerequisite.
- **dojo / listen / oddjob / lab** — no database. Their content is hardcoded in
  JSX, so there is nothing for a tool to change until it's moved into the DB.
