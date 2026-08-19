/**
 * Behavioral tests for the data-loss-critical tool logic, run against a mock
 * site served by Bun on a random port. The smoke test proves the server boots
 * and advertises; these prove the behaviors that protect real data:
 *
 *   - update_item merges instead of letting the site's full-replace PUT null
 *     untouched columns
 *   - stop_timer keeps all / id / track mutually exclusive so a missing
 *     argument can't stop every lane
 *   - the local validators reject what the site would reject, before the wire
 *   - an expired session heals with exactly one re-login
 *
 *   bun test tests/
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

type Captured = { method: string; path: string; body: unknown };

const ITEM_ROW = {
  id: "otto",
  category: "projects",
  title: "Otto",
  description: "Telegram-native AI agent",
  year: 2026,
  tech: JSON.stringify(["bun", "claude"]),
  link: "https://example.com",
  repo: "justin06lee/otto",
  live: null,
  notes: "keep",
  sort_order: 3,
  pinned: 1,
  collection: "agents",
};

const captured: Captured[] = [];
const auth = { loginCount: 0, valid: new Set<string>() };
const LISTEN_KEY = "listen-key";

const site = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const cookies = req.headers.get("cookie") ?? "";
    const readBody = () =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
        ? req.json().catch(() => null)
        : Promise.resolve(null);

    // listen: public reads, raw-key cookie for writes.
    if (path === "/api/studio") return Response.json({ owner: true, configured: true });
    if (path === "/api/room") {
      if (req.method === "POST") {
        if (!cookies.includes(`listen_owner=${LISTEN_KEY}`)) {
          return Response.json({ error: "not the broadcaster" }, { status: 401 });
        }
        captured.push({ method: req.method, path, body: await readBody() });
      }
      return Response.json({
        trackId: null,
        playlistId: null,
        position: 0,
        playing: false,
        live: false,
        silentFor: -1,
      });
    }

    // Login — the main site, truman, and the shared-key sites all exchange a
    // password for a cookie. truman's body has `name`; the password-only shape
    // gets every shared-key cookie at once so each client finds its own.
    if (path === "/api/auth" && req.method === "POST") {
      const body = (await readBody()) as { name?: string } | null;
      auth.loginCount += 1;
      const token = `tok${auth.loginCount}`;
      auth.valid.add(token);
      const headers = new Headers({ "content-type": "application/json" });
      const names =
        body?.name !== undefined
          ? ["truman_session"]
          : ["admin_session", "coffee_admin_session", "oddjob_admin_session"];
      for (const name of names) headers.append("set-cookie", `${name}=${token}; Path=/; HttpOnly`);
      return new Response("{}", { headers });
    }

    // leet's key login lives on its own path and mints the OAuth cookie.
    if (path === "/api/auth/key" && req.method === "POST") {
      auth.loginCount += 1;
      const token = `tok${auth.loginCount}`;
      auth.valid.add(token);
      return new Response("{}", {
        headers: { "set-cookie": `leet_session=${token}; Path=/; HttpOnly` },
      });
    }

    const token =
      /(?:^|;\s*)(?:coffee_admin_session|oddjob_admin_session|admin_session|truman_session|leet_session)=([^;]+)/.exec(
        cookies,
      )?.[1];
    if (!token || !auth.valid.has(token)) return new Response("unauthorized", { status: 401 });

    captured.push({ method: req.method, path, body: await readBody() });

    if (path === "/api/items" && req.method === "GET") return Response.json([ITEM_ROW]);
    if (path === "/api/calendar/actuals/running") return new Response(null, { status: 204 });
    if (path === "/api/board") return Response.json({ categories: [] });
    if (path === "/api/event-types" && req.method === "GET") return Response.json([]);
    if (path === "/api/requests" && req.method === "GET") {
      return Response.json({ requests: [], total: 0, limit: 15, offset: 0 });
    }
    if (path === "/api/admin/articles" && req.method === "GET") return Response.json([]);
    if (path === "/admin/attachment/att-txt") {
      return new Response("hello notes", { headers: { "content-type": "text/plain" } });
    }
    if (path === "/admin/attachment/att-pdf") {
      return new Response("%PDF-1.4", { headers: { "content-type": "application/pdf" } });
    }
    return Response.json({});
  },
});

let client: Client;

beforeAll(async () => {
  const base = `http://localhost:${site.port}`;
  const server = createServer({
    siteUrl: base,
    adminKey: "test-key",
    trumanUrl: base,
    trumanOwnerKey: "truman-key",
    listenUrl: base,
    listenOwnerKey: LISTEN_KEY,
    todoUrl: base,
    coffeeUrl: base,
    oddjobUrl: base,
    leetUrl: base,
    leetAdminKey: "leet-key",
    requestTimeoutMs: 5_000,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "behavior-test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client.close();
  await site.stop();
});

/** Calls a tool; schema-invalid arguments surface as a throw or an isError result. */
async function call(name: string, args: Record<string, unknown>) {
  captured.length = 0;
  try {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return { error: result.isError === true, text: result.content[0]?.text ?? "" };
  } catch (error) {
    return { error: true, text: error instanceof Error ? error.message : String(error) };
  }
}

test("update_item carries every untouched field into the full-replace PUT", async () => {
  const res = await call("update_item", { id: "otto", title: "Otto v2" });
  expect(res.error).toBe(false);

  const put = captured.find((c) => c.method === "PUT");
  expect(put?.path).toBe("/api/items/otto");
  expect(put?.body).toEqual({
    category: "projects",
    title: "Otto v2",
    description: "Telegram-native AI agent",
    year: 2026,
    tech: ["bun", "claude"],
    link: "https://example.com",
    repo: "justin06lee/otto",
    live: null,
    notes: "keep",
    sort_order: 3,
    pinned: true,
    collection: "agents",
  });
});

test("update_item can clear the collection with an explicit null", async () => {
  const res = await call("update_item", { id: "otto", collection: null });
  expect(res.error).toBe(false);

  const put = captured.find((c) => c.method === "PUT");
  expect((put?.body as { collection: string | null }).collection).toBeNull();
});

test("update_item with an unknown id fails without sending a PUT", async () => {
  const res = await call("update_item", { id: "nope", title: "x" });
  expect(res.error).toBe(true);
  expect(captured.some((c) => c.method === "PUT")).toBe(false);
});

test("create_item refuses a duplicate id before POSTing", async () => {
  const res = await call("create_item", {
    id: "otto",
    category: "projects",
    title: "Otto",
    description: "dup",
    year: 2026,
    tech: [],
  });
  expect(res.error).toBe(true);
  expect(captured.some((c) => c.method === "POST")).toBe(false);
});

test("stop_timer with no arguments sends an empty body (primary lane only)", async () => {
  await call("stop_timer", {});
  expect(captured.at(-1)?.body).toEqual({});
});

test("stop_timer all/id/track stay mutually exclusive", async () => {
  await call("stop_timer", { all: true, id: "e1", track: 3 });
  expect(captured.at(-1)?.body).toEqual({ all: true });

  await call("stop_timer", { id: "e1", track: 3 });
  expect(captured.at(-1)?.body).toEqual({ id: "e1" });

  await call("stop_timer", { track: 0 });
  expect(captured.at(-1)?.body).toEqual({ track: 0 });
});

test("get_running_timers turns the 204 into an empty list, not an error", async () => {
  const res = await call("get_running_timers", {});
  expect(res.error).toBe(false);
  expect(res.text).toContain("No timers running");
});

test("create_time_entry rejects endAt <= startAt locally", async () => {
  const res = await call("create_time_entry", {
    startAt: 1_750_000_000_000,
    endAt: 1_750_000_000_000,
  });
  expect(res.error).toBe(true);
  expect(captured.some((c) => c.method === "POST")).toBe(false);
});

test("create_time_entry catches seconds-precision timestamps", async () => {
  const res = await call("create_time_entry", { startAt: 1_750_000_000, endAt: 1_750_000_100 });
  expect(res.error).toBe(true);
  expect(res.text).toContain("MILLISECONDS");
  expect(captured.some((c) => c.method === "POST")).toBe(false);
});

test("list_time_entries rejects a range beyond the site's 400-day cap", async () => {
  const res = await call("list_time_entries", { from: "2024-01-01", to: "2026-01-01" });
  expect(res.error).toBe(true);
  expect(res.text).toContain("400");
  expect(captured.length).toBe(0);
});

test("an expired session heals with exactly one re-login", async () => {
  const before = auth.loginCount;
  auth.valid.clear(); // server-side session expiry
  const res = await call("list_items", {});
  expect(res.error).toBe(false);
  expect(auth.loginCount).toBe(before + 1);
});

test("truman_revoke_sessions requires the target to be explicit", async () => {
  for (const args of [{}, { id: "s1", all: true }]) {
    const res = await call("truman_revoke_sessions", args);
    expect(res.error).toBe(true);
    expect(captured.length).toBe(0); // never reached the site
  }

  await call("truman_revoke_sessions", { id: "s1" });
  expect(captured.at(-1)?.body).toEqual({ id: "s1" });

  await call("truman_revoke_sessions", { all: true, clear_chat: true });
  expect(captured.at(-1)?.body).toEqual({ clearChat: true });
});

test("truman_post_chat rides the truman session cookie", async () => {
  const res = await call("truman_post_chat", { body: "hello room" });
  expect(res.error).toBe(false);
  expect(captured.at(-1)).toMatchObject({ method: "POST", path: "/api/chat", body: { body: "hello room" } });
});

test("listen_set_room always sends the full four-field replace", async () => {
  const res = await call("listen_set_room", { playing: true });
  expect(res.error).toBe(false);
  expect(captured.at(-1)?.body).toEqual({
    trackId: null,
    playlistId: null,
    position: 0,
    playing: true,
  });
});

test("listen_room_status merges room and studio state", async () => {
  const res = await call("listen_room_status", {});
  expect(res.error).toBe(false);
  expect(JSON.parse(res.text)).toMatchObject({ live: false, broadcastConfigured: true });
});

test("upload_image demands exactly one source and rejects oversized files", async () => {
  const neither = await call("upload_image", {});
  expect(neither.error).toBe(true);

  const both = await call("upload_image", { path: "/tmp/x.png", base64: "aGk=" });
  expect(both.error).toBe(true);

  const noName = await call("upload_image", { base64: "aGk=" });
  expect(noName.error).toBe(true);
  expect(noName.text).toContain("filename");

  expect(captured.length).toBe(0); // none of the rejects hit the site
});

test("a keyless truman client fails with the env var named", async () => {
  const base = `http://localhost:${site.port}`;
  const server = createServer({
    siteUrl: base,
    adminKey: "test-key",
    trumanUrl: base,
    trumanOwnerKey: null,
    listenUrl: base,
    listenOwnerKey: null,
    todoUrl: base,
    coffeeUrl: base,
    oddjobUrl: base,
    leetUrl: base,
    leetAdminKey: null,
    requestTimeoutMs: 5_000,
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const bare = new Client({ name: "keyless-test", version: "0" });
  await Promise.all([server.connect(st), bare.connect(ct)]);

  const stream = (await bare.callTool({ name: "truman_stream_status", arguments: {} })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  expect(stream.isError).toBe(true);
  expect(stream.content[0]?.text).toContain("TRUMAN_OWNER_KEY");

  const room = (await bare.callTool({ name: "listen_set_room", arguments: {} })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  expect(room.isError).toBe(true);
  expect(room.content[0]?.text).toContain("LISTEN_OWNER_KEY");

  const articles = (await bare.callTool({ name: "leet_list_articles", arguments: {} })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  expect(articles.isError).toBe(true);
  expect(articles.content[0]?.text).toContain("LEET_ADMIN_KEY");

  await bare.close();
});

test("todo, coffee, oddjob, and leet each authenticate on their own cookie", async () => {
  for (const [name, args] of [
    ["todo_get_board", {}],
    ["coffee_list_event_types", {}],
    ["oddjob_list_requests", {}],
    ["leet_list_articles", {}],
  ] as const) {
    const res = await call(name, args);
    expect(res.error).toBe(false);
  }
});

test("oddjob_update_request refuses an empty patch locally", async () => {
  const res = await call("oddjob_update_request", { id: "OJ-0001" });
  expect(res.error).toBe(true);
  expect(captured.length).toBe(0);
});

test("todo_create_category rejects a colour outside the palette locally", async () => {
  const res = await call("todo_create_category", { name: "reading", color: "#ff0000" });
  expect(res.error).toBe(true);
  expect(captured.length).toBe(0);
});

test("coffee_list_bookings rejects a range beyond the 400-day cap locally", async () => {
  const res = await call("coffee_list_bookings", { from: "2024-01-01", to: "2026-01-01" });
  expect(res.error).toBe(true);
  expect(res.text).toContain("400");
  expect(captured.length).toBe(0);
});

test("oddjob_get_attachment returns text inline and refuses binary without save_path", async () => {
  const text = await call("oddjob_get_attachment", { id: "att-txt" });
  expect(text.error).toBe(false);
  expect(text.text).toContain("hello notes");

  const pdf = await call("oddjob_get_attachment", { id: "att-pdf" });
  expect(pdf.error).toBe(true);
  expect(pdf.text).toContain("save_path");
});
