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
};

const captured: Captured[] = [];
const auth = { loginCount: 0, valid: new Set<string>() };

const site = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/auth" && req.method === "POST") {
      auth.loginCount += 1;
      const token = `tok${auth.loginCount}`;
      auth.valid.add(token);
      return new Response("{}", {
        headers: { "set-cookie": `admin_session=${token}; Path=/; HttpOnly` },
      });
    }

    const token = /admin_session=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
    if (!token || !auth.valid.has(token)) return new Response("unauthorized", { status: 401 });

    const body = ["POST", "PUT", "PATCH"].includes(req.method)
      ? await req.json().catch(() => null)
      : null;
    captured.push({ method: req.method, path, body });

    if (path === "/api/items" && req.method === "GET") return Response.json([ITEM_ROW]);
    if (path === "/api/calendar/actuals/running") return new Response(null, { status: 204 });
    return Response.json({});
  },
});

let client: Client;

beforeAll(async () => {
  const server = createServer({
    siteUrl: `http://localhost:${site.port}`,
    adminKey: "test-key",
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
  });
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
