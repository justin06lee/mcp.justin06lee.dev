import { SiteClient } from "./client.ts";
import { loadConfig } from "./config.ts";

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

  const client = new SiteClient(config);

  // The first authenticated call performs the login exchange, so a passing
  // read proves reachability, ADMIN_KEY, and the session cookie all at once.
  await step("auth + items", async () => {
    const items = await client.request<unknown[]>("/api/items");
    return `${items.length} portfolio item(s)`;
  });

  await step("site config", async () => {
    const site = await client.request<{ description?: string[] }>("/api/config");
    return `${site.description?.length ?? 0} bio line(s)`;
  });

  await step("calendar categories", async () => {
    const cats = await client.request<unknown[]>("/api/calendar/categories");
    return `${cats.length} categor(y/ies)`;
  });

  await step("timers", async () => {
    const res = await client.request<{ running: unknown[] } | null>(
      "/api/calendar/actuals/running",
      { query: { all: "1" } },
    );
    return `${res?.running?.length ?? 0} running`;
  });

  log(failed ? "\nSomething is wrong — see the FAIL lines above." : "\nAll checks passed.");
  return failed ? 1 : 0;
}
