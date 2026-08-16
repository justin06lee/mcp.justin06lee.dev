import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionClient, StaticCookieClient } from "./client.ts";
import type { Config } from "./config.ts";
import { registerItemTools } from "./tools/items.ts";
import { registerSiteConfigTools } from "./tools/site-config.ts";
import { registerCalendarTools } from "./tools/calendar.ts";
import { registerTimerTools } from "./tools/timers.ts";
import { registerUploadTools } from "./tools/uploads.ts";
import { registerArticleTools } from "./tools/articles.ts";
import { registerTrumanTools } from "./tools/truman.ts";
import { registerListenTools } from "./tools/listen.ts";
import pkg from "../package.json";

/** Single source of truth: package.json. The bundle inlines it at build time. */
export const VERSION: string = pkg.version;

export function siteClient(config: Config): SessionClient {
  return new SessionClient({
    baseUrl: config.siteUrl,
    key: config.adminKey,
    timeoutMs: config.requestTimeoutMs,
    cookieName: "admin_session",
    loginPath: "/api/auth",
    loginBody: (key) => ({ password: key }),
  });
}

export function trumanClient(config: Config): SessionClient | null {
  if (!config.trumanOwnerKey) return null;
  return new SessionClient({
    baseUrl: config.trumanUrl,
    key: config.trumanOwnerKey,
    timeoutMs: config.requestTimeoutMs,
    cookieName: "truman_session",
    loginPath: "/api/auth",
    // The name becomes the chat handle for everything this server posts.
    loginBody: (key) => ({ password: key, name: "otto" }),
  });
}

export function listenClient(config: Config): StaticCookieClient {
  return new StaticCookieClient(
    config.listenUrl,
    config.requestTimeoutMs,
    config.listenOwnerKey ? `listen_owner=${encodeURIComponent(config.listenOwnerKey)}` : null,
  );
}

/**
 * Builds the server with every tool registered but no transport attached.
 * Transport binding is the caller's job, so the same core can be served over
 * stdio locally today and over HTTP from the home server later without any of
 * the tool code knowing the difference.
 *
 * Every tool always registers, even when its app's key is missing — the
 * manifest stays deterministic and a keyless call fails with a message naming
 * the env var to set.
 */
export function createServer(config: Config): McpServer {
  const server = new McpServer(
    { name: "justin06lee-mcp", version: VERSION },
    {
      instructions:
        `Controls the justin06lee.dev ecosystem: the main site at ${config.siteUrl} ` +
        "(portfolio items, homepage bio and socials, calendar plans, categories, time " +
        "tracking, image uploads, article cache), the truman live-video room at " +
        `${config.trumanUrl} (truman_* tools), and the listen music room at ` +
        `${config.listenUrl} (listen_* tools).\n\n` +
        "Ids are opaque: always list before you update or delete rather than guessing one. " +
        "Dates are YYYY-MM-DD in the site's configured timezone (see get_site_config); " +
        "timestamps on time entries are epoch milliseconds. Deletes are immediate and " +
        "permanent, so confirm with the user before calling one.",
    },
  );

  const site = siteClient(config);

  registerItemTools(server, site);
  registerSiteConfigTools(server, site);
  registerCalendarTools(server, site);
  registerTimerTools(server, site);
  registerUploadTools(server, site);
  registerArticleTools(server, site);
  registerTrumanTools(server, trumanClient(config));
  registerListenTools(server, listenClient(config), config.listenOwnerKey !== null);

  return server;
}
