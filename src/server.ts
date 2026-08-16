import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SiteClient } from "./client.ts";
import type { Config } from "./config.ts";
import { registerItemTools } from "./tools/items.ts";
import { registerSiteConfigTools } from "./tools/site-config.ts";
import { registerCalendarTools } from "./tools/calendar.ts";
import { registerTimerTools } from "./tools/timers.ts";
import pkg from "../package.json";

/** Single source of truth: package.json. The bundle inlines it at build time. */
export const VERSION: string = pkg.version;

/**
 * Builds the server with every tool registered but no transport attached.
 * Transport binding is the caller's job, so the same core can be served over
 * stdio locally today and over HTTP from the home server later without any of
 * the tool code knowing the difference.
 */
export function createServer(config: Config): McpServer {
  const server = new McpServer(
    { name: "justin06lee-mcp", version: VERSION },
    {
      instructions:
        `Controls the justin06lee.dev deployment at ${config.siteUrl} — portfolio items, ` +
        "homepage bio and socials, calendar plans, categories, and time tracking.\n\n" +
        "Ids are opaque: always list before you update or delete rather than guessing one. " +
        "Dates are YYYY-MM-DD in the site's configured timezone (see get_site_config); " +
        "timestamps on time entries are epoch milliseconds. Deletes are immediate and " +
        "permanent, so confirm with the user before calling one.",
    },
  );

  const client = new SiteClient(config);

  registerItemTools(server, client);
  registerSiteConfigTools(server, client);
  registerCalendarTools(server, client);
  registerTimerTools(server, client);

  return server;
}
