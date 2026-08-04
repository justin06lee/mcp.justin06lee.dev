# agent notes

MCP server wrapping the justin06lee.dev HTTP API. See `README.md` for setup and
the tool list; this file is the stuff that bites you when editing.

## rules

**Never talk to Turso directly.** Every tool goes through the site's HTTP API.
Direct database writes skip `revalidatePath()` and leave the site serving a
stale cached page — the data changes and the site doesn't. If an endpoint is
missing, add the route to the site, not a database call here.

**stdout is the MCP wire protocol.** Any `console.log` in `src/` corrupts the
stream and the client silently drops the connection. Diagnostics go to
`console.error`.

**`server.ts` binds no transport.** Keep it that way — it's the seam that lets
this be served over HTTP later without touching tool code.

**Mirror the site's limits, don't invent them.** `src/tools/shared.ts` copies
`MAX_TITLE_LEN`, `MAX_RANGE_DAYS`, the category palette, and the track range
from the site. When the site changes one, change it here too — the constants are
duplicated on purpose so bad input fails locally with a clear message instead of
as a 400.

## gotchas

- **`PUT /api/items/:id` is a full replace.** Omitted fields are written as
  null. `update_item` reads the current row and merges; keep it that way.
- **`GET /api/calendar/actuals/running` returns 204, not `[]`,** when nothing is
  running. `SiteClient.request` maps that to `null`.
- **Auth is a session cookie, not a header.** `SiteClient` exchanges `ADMIN_KEY`
  for one lazily and re-logs in once on a 401. It retries exactly once — more
  would walk into the site's login rate limiter (10 attempts / 15 min, then a
  24h lockout).
- **Login rate limiting is per-IP and harsh.** Don't add retry loops around
  auth.
- **Empty strings are not null.** Every id schema uses `.min(1)` so a blank id
  is rejected here rather than sent as one. Don't relax that — the server-side
  handling of a blank id is not something to rely on.
- **An omitted `track` means the primary lane, never "all lanes".** `stop_timer`
  keeps `all` / `id` / `track` mutually exclusive so a missing argument can't
  wipe out every running timer.

## checks

```bash
bun run check    # typecheck + smoke
```

`scripts/smoke.ts` boots the built server over stdio and asserts the tool
manifest, schemas, and error handling. It points `SITE_URL` at an unreachable
port on purpose — it never touches the network or a real database. Add new tools
to its `EXPECTED` list.
