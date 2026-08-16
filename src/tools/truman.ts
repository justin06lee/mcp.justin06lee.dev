import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import { fail, guarded, ok, type ToolResult } from "./shared.ts";

/** Mirrors truman's chat limit so an over-long message fails locally. */
const MAX_CHAT_BODY = 500;

/**
 * truman.justin06lee.dev — the private live-video room. Everything here rides the
 * owner session (TRUMAN_OWNER_KEY → truman_session cookie). The box-key routes
 * (stream reports, episode filing) belong to the camera machine and are
 * deliberately not wrapped: this server should never impersonate the box.
 */
export function registerTrumanTools(server: McpServer, client: ApiClient | null): void {
  const need =
    "TRUMAN_OWNER_KEY is not set. Add it to this server's environment to control " +
    "truman.justin06lee.dev.";

  const withClient = <A,>(
    handler: (client: ApiClient, args: A) => Promise<ToolResult>,
  ): ((args: A) => Promise<ToolResult>) =>
    guarded(async (args: A) => (client ? handler(client, args) : fail(need)));

  server.registerTool(
    "truman_stream_status",
    {
      title: "Get truman stream status",
      description:
        "Show whether the truman room is live / connecting / stopping / offline, since " +
        "when, and who is watching right now.",
      inputSchema: {},
    },
    withClient(async (c) => ok(await c.request("/api/stream"))),
  );

  server.registerTool(
    "truman_set_live",
    {
      title: "Switch the truman stream on or off",
      description:
        "Flip the on-air switch. The camera box polls this every few seconds, so expect " +
        "'connecting' for a moment before the stream reads live. Turning it off ends the " +
        "session and the box files a timelapse episode.",
      inputSchema: { live: z.boolean() },
    },
    withClient(async (c, { live }: { live: boolean }) =>
      ok(await c.request("/api/stream/desired", { method: "POST", body: { live } })),
    ),
  );

  server.registerTool(
    "truman_read_chat",
    {
      title: "Read truman chat",
      description:
        "Read room chat. Without `since`, returns the most recent 100 messages; with " +
        "`since` (a message id), returns everything after it.",
      inputSchema: {
        since: z.number().int().min(1).optional().describe("Return messages with id > since."),
      },
    },
    withClient(async (c, { since }: { since?: number }) =>
      ok(await c.request("/api/chat", { query: { since } })),
    ),
  );

  server.registerTool(
    "truman_post_chat",
    {
      title: "Post to truman chat",
      description:
        "Say something in the room chat. The message appears under this session's name " +
        "('otto') and is read aloud in the room by the announcer.",
      inputSchema: { body: z.string().min(1).max(MAX_CHAT_BODY) },
    },
    withClient(async (c, { body }: { body: string }) =>
      ok(await c.request("/api/chat", { method: "POST", body: { body } })),
    ),
  );

  server.registerTool(
    "truman_clear_chat",
    {
      title: "Clear truman chat",
      description: "Wipe the entire chat log for everyone. Permanent — confirm with the user first.",
      inputSchema: {},
    },
    withClient(async (c) => ok(await c.request("/api/chat", { method: "DELETE" }))),
  );

  server.registerTool(
    "truman_revoke_sessions",
    {
      title: "Evict truman viewers",
      description:
        "Revoke viewer sessions; their video cuts within seconds. Pass `id` (from " +
        "truman_stream_status's watching list) to evict one viewer, or `all: true` to evict " +
        "everyone except this server. `clear_chat` additionally wipes chat and only applies " +
        "with `all`.",
      inputSchema: {
        id: z.string().min(1).optional(),
        all: z.boolean().optional(),
        clear_chat: z.boolean().optional(),
      },
    },
    withClient(
      async (c, { id, all, clear_chat }: { id?: string; all?: boolean; clear_chat?: boolean }) => {
        // The site treats a missing id as "revoke everyone", so require the
        // intent to be explicit — a dropped argument must not clear the room.
        if (Boolean(id) === Boolean(all)) {
          return fail("Pass exactly one of `id` (one viewer) or `all: true` (everyone).");
        }
        if (clear_chat && !all) return fail("`clear_chat` only applies with `all: true`.");
        const body = id ? { id } : { clearChat: clear_chat === true };
        return ok(await c.request("/api/sessions", { method: "DELETE", body }));
      },
    ),
  );

  server.registerTool(
    "truman_delete_episode",
    {
      title: "Delete a truman episode",
      description:
        "Permanently delete a recorded timelapse episode and its clip files. There is no " +
        "list endpoint — episode ids come from the site's /episodes pages and look like " +
        "'2026-08-15T14-03-22Z'. Confirm with the user first.",
      inputSchema: { id: z.string().min(1) },
    },
    withClient(async (c, { id }: { id: string }) =>
      ok(
        await c.request(`/api/episodes/${encodeURIComponent(id)}`, { method: "DELETE" }),
        `Deleted episode ${id}.`,
      ),
    ),
  );
}
