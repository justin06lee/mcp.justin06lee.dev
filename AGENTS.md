# agent notes

MCP server wrapping the justin06lee.dev ecosystem's HTTP APIs — the main site
plus truman (live video) and listen (music room). See `README.md` for setup and
the tool list; this file is the stuff that bites you when editing.

## rules

**Never talk to Turso directly.** Every tool goes through a site's HTTP API.
Direct database writes skip `revalidatePath()` and leave the site serving a
stale cached page — the data changes and the site doesn't. If an endpoint is
missing, add the route to the site, not a database call here.

**stdout is the MCP wire protocol.** Any `console.log` while serving corrupts
the stream and the client silently drops the connection. Diagnostics go to
`console.error`. (`--help`/`--version` print to stdout — no transport is
attached on those paths.)

**`server.ts` binds no transport.** Keep it that way — it's the seam that lets
this be served over HTTP later without touching tool code.

**Mirror the sites' limits, don't invent them.** `src/tools/shared.ts` copies
`MAX_TITLE_LEN`, `MAX_RANGE_DAYS`, the category palette, and the track range
from the main site; `truman.ts` mirrors the 500-char chat cap; `uploads.ts`
mirrors the 5 MB / 10 MB upload caps. When a site changes one, change it here
too — the constants are duplicated on purpose so bad input fails locally with a
clear message instead of as a 400.

**Tools always register.** A missing `TRUMAN_OWNER_KEY`/`LISTEN_OWNER_KEY`
makes those tools fail at call time with a message naming the env var — never
make registration conditional, or the manifest (and the smoke test) stops being
deterministic.

## gotchas

- **`PUT /api/items/:id` is a full replace.** Omitted fields are written as
  null. `update_item` reads the current row and merges; keep it that way.
- **`GET /api/calendar/actuals/running` returns 204, not `[]`,** when nothing
  is running. The client maps that to `null`.
- **Auth is cookies everywhere; no site has a header-token path.** Three
  models, all in `client.ts`: the main site and truman exchange a password for
  a session cookie (`SessionClient`); listen's cookie value IS the raw owner
  key (`StaticCookieClient`). Session clients re-log-in exactly once on a 401 —
  more would walk into the sites' login rate limiters (10 attempts / 15 min,
  then a 24h lockout).
- **Login rate limiting is per-IP and harsh, on every site.** Don't add retry
  loops around auth. hours and the main site even share the `login_attempts`
  table — burning attempts on one locks the human out of both.
- **Empty strings are not null.** Every id schema uses `.min(1)` so a blank id
  is rejected here rather than sent as one.
- **An omitted `track` means the primary lane, never "all lanes".** `stop_timer`
  keeps `all` / `id` / `track` mutually exclusive so a missing argument can't
  wipe out every running timer.
- **`POST /api/calendar/actuals` silently drops `track`** — backfilled entries
  always land on lane 0, and `PATCH` can't move them. Don't add a track field
  to `create_time_entry`; it would lie.
- **truman's `DELETE /api/sessions` with no id evicts everyone.**
  `truman_revoke_sessions` requires explicit `id` or `all: true`; keep that.
- **listen's `POST /api/room` is a full replace of all four fields.**
  `listen_set_room` always sends all four. Also: the listen track catalogue is
  hardcoded in the listen repo and currently empty, so any non-null `trackId`
  400s until tracks are added there.
- **Blind deletes on the main site.** Items/uploads DELETE (and items PUT)
  return `200 {ok:true}` even for nonexistent ids. Tools that need truthful
  results read first (`delete_item`, `delete_upload` do).
- **`/api/items` returns snake_case raw rows; calendar endpoints return
  camelCase mapped objects.** Don't "fix" one to match the other.
- **truman's `name` is set at login** (`loginBody` sends `name: "otto"`) — chat
  posts can't carry a different name per message.

## deployment shape

This is **not a daemon**. It's an MCP stdio server: the agent (Otto → Claude
Code) spawns it as a child process per session and talks over stdin/stdout,
exactly like `otto-memory`. No port, no service unit, nothing to keep alive.
Don't add a supervisor, a PID file, or a listening socket. It runs on the tenet
box (Arch, on the tailnet); `make deploy` cross-compiles, ships it there,
doctors it with the registered env, and restarts Otto.

`install.sh` builds a self-contained binary (via `bun build --compile`, so the
target needs neither Node nor Bun) into `~/.local/bin` and merges one entry
into `~/.config/otto/mcp.json`, preserving optional env keys already there.

**Otto's `setup.sh` truncates and rewrites `mcp.json`** — `config = {"mcpServers":
{}}` then `>` — so it drops this entry every time it runs. `install.sh` is
idempotent to make recovering from that a one-liner. Fixing it properly means
teaching Otto's setup.sh to preserve unknown servers.

## checks

```bash
bun run check    # typecheck + behavioral tests + smoke
```

`tests/behavior.test.ts` runs the tools against a mock site over a real MCP
client and pins the data-loss-critical logic (merge-on-update, stop/revoke
exclusivity, validators, the 204 path, single-retry session heal).
`scripts/smoke.ts` boots the built server over stdio and asserts the tool
manifest, schemas, and error handling. It points `SITE_URL` at an unreachable
port on purpose — it never touches the network or a real database. Add new
tools to its `EXPECTED` list.

## ecosystem coverage map

Kept here so the next sweep doesn't re-derive it:

| app | HTTP surface | covered |
|---|---|---|
| justin06lee.dev | full admin API | yes — everything except giving pats (Origin-gated) and the article-CMS server actions |
| hours | none of its own — shares the main site's DB/tables | via the calendar/timer tools |
| truman | full API (cookie session + separate box bearer key) | owner surface yes; box routes deliberately not |
| listen | room/studio/presence | room + studio yes; presence heartbeat deliberately not |
| coffee | server actions only (+ read-only ICS) | no — needs routes added in that repo |
| oddjob | server actions only (+ session-gated attachment GET) | no — same |
| leet | OAuth plumbing only; admin is owner-session actions | no — same |
| chrome | static registry, no server state | nothing to cover |
