import { loadConfig } from "./config.ts";
import {
  coffeeClient,
  leetClient,
  listenClient,
  oddjobClient,
  siteClient,
  todoClient,
  trumanClient,
} from "./server.ts";

/**
 * `--doctor` exists because a stdio MCP server is otherwise invisible: it is
 * spawned by the agent, speaks a binary-ish protocol on stdout, and logs to a
 * file you have to go find. This is the one way to answer "is it actually
 * wired up?" from a terminal, without going through Telegram.
 *
 * Everything is written to stderr so the check can be run even when stdout is
 * being piped somewhere that expects protocol traffic.
 */
export async function doctor(): Promise<number> {
  const log = (line: string) => console.error(line);
  let failed = false;

  const step = async (label: string, run: () => Promise<string>): Promise<void> => {
    try {
      log(`  ok    ${label} — ${await run()}`);
    } catch (error) {
      failed = true;
      log(`  FAIL  ${label} — ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  log("justin06lee-mcp doctor\n");

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    log(`  FAIL  config — ${error instanceof Error ? error.message : String(error)}`);
    log("\nSet ADMIN_KEY (and optionally SITE_URL) in the environment.");
    return 1;
  }

  log(`  ok    config — SITE_URL=${config.siteUrl}, ADMIN_KEY set (${config.adminKey.length} chars)`);

  const site = siteClient(config);

  // The first authenticated call performs the login exchange, so a passing
  // read proves reachability, ADMIN_KEY, and the session cookie all at once.
  await step("auth + items", async () => {
    const items = await site.request<unknown[]>("/api/items");
    return `${items.length} portfolio item(s)`;
  });

  await step("site config", async () => {
    const siteConfig = await site.request<{ description?: string[] }>("/api/config");
    return `${siteConfig.description?.length ?? 0} bio line(s)`;
  });

  await step("calendar categories", async () => {
    const cats = await site.request<unknown[]>("/api/calendar/categories");
    return `${cats.length} categor(y/ies)`;
  });

  await step("timers", async () => {
    const res = await site.request<{ running: unknown[] } | null>(
      "/api/calendar/actuals/running",
      { query: { all: "1" } },
    );
    return `${res?.running?.length ?? 0} running`;
  });

  await step("uploads", async () => {
    const rows = await site.request<unknown[]>("/api/uploads", { query: { limit: 1 } });
    return rows.length > 0 ? "reachable, has uploads" : "reachable, empty";
  });

  // todo/coffee/oddjob authenticate with the same shared ADMIN_KEY, so a
  // passing read on each proves that deployment carries the key too.
  await step("todo board", async () => {
    const board = await todoClient(config).request<{ categories: unknown[] }>("/api/board");
    return `${board.categories.length} categor(y/ies)`;
  });

  await step("coffee event types", async () => {
    const types = await coffeeClient(config).request<unknown[]>("/api/event-types");
    return `${types.length} event type(s)`;
  });

  await step("oddjob inbox", async () => {
    const inbox = await oddjobClient(config).request<{ total: number }>("/api/requests", {
      query: { limit: 1 },
    });
    return `${inbox.total} request(s)`;
  });

  const leet = leetClient(config);
  if (leet) {
    await step("leet articles", async () => {
      const articles = await leet.request<unknown[]>("/api/admin/articles");
      return `${articles.length} article(s)`;
    });
  } else {
    log("  skip  leet — LEET_ADMIN_KEY not set");
  }

  const truman = trumanClient(config);
  if (truman) {
    await step("truman stream", async () => {
      const stream = await truman.request<{ status: string; watching: unknown[] }>("/api/stream");
      return `${stream.status}, ${stream.watching.length} watching`;
    });
  } else {
    log("  skip  truman — TRUMAN_OWNER_KEY not set");
  }

  if (config.listenOwnerKey) {
    await step("listen room", async () => {
      const listen = listenClient(config);
      const studio = await listen.request<{ owner: boolean; configured: boolean }>("/api/studio");
      if (!studio.configured) return "reachable, but no broadcaster key configured server-side";
      return studio.owner ? "owner key accepted" : "reachable, but LISTEN_OWNER_KEY was rejected";
    });
  } else {
    log("  skip  listen — LISTEN_OWNER_KEY not set");
  }

  log(failed ? "\nSomething is wrong — see the FAIL lines above." : "\nAll checks passed.");
  return failed ? 1 : 0;
}
