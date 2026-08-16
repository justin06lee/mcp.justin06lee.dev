import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import { fail, guarded, ok } from "./shared.ts";

type RoomSnapshot = {
  trackId: string | null;
  playlistId: string | null;
  position: number;
  playing: boolean;
  live: boolean;
  silentFor: number;
};

/**
 * listen.justin06lee.dev — the single-room synced music player. Reading the room
 * is public; writing needs LISTEN_OWNER_KEY (the cookie value IS the key, no
 * login exchange). The track catalogue is hardcoded in the listen repo, so
 * trackId must name a track that actually exists there.
 */
export function registerListenTools(
  server: McpServer,
  client: ApiClient,
  hasOwnerKey: boolean,
): void {
  server.registerTool(
    "listen_room_status",
    {
      title: "Get the listen room status",
      description:
        "Read the music room: current track/playlist, playback position (seconds, " +
        "server-extrapolated), whether a broadcaster is live, and how long the room has " +
        "been silent (-1 means never used). Also reports whether broadcasting is configured.",
      inputSchema: {},
    },
    guarded(async () => {
      const [room, studio] = await Promise.all([
        client.request<RoomSnapshot>("/api/room"),
        client.request<{ owner: boolean; configured: boolean }>("/api/studio"),
      ]);
      return ok({ ...room, broadcastConfigured: studio.configured, actingAsOwner: studio.owner });
    }),
  );

  server.registerTool(
    "listen_set_room",
    {
      title: "Set the listen room state",
      description:
        "Broadcast room state as the owner. This is a FULL REPLACE — every call sets all " +
        "four fields; omitted ones fall back to their defaults (null/0/false), so read " +
        "listen_room_status first to preserve what you don't mean to change. trackId must " +
        "exist in the listen site's track catalogue or the site rejects it. While 'playing', " +
        "the room goes dark unless state is re-posted at least every 90 seconds.",
      inputSchema: {
        trackId: z.string().min(1).nullable().optional().describe("null clears the track."),
        playlistId: z.string().min(1).nullable().optional(),
        position: z.number().min(0).optional().describe("Playback position in seconds."),
        playing: z.boolean().optional(),
      },
    },
    guarded(async ({ trackId, playlistId, position, playing }) => {
      if (!hasOwnerKey) {
        return fail(
          "LISTEN_OWNER_KEY is not set. Add it to this server's environment to control " +
            "listen.justin06lee.dev.",
        );
      }
      const body = {
        trackId: trackId ?? null,
        playlistId: playlistId ?? null,
        position: position ?? 0,
        playing: playing ?? false,
      };
      return ok(await client.request<RoomSnapshot>("/api/room", { method: "POST", body }));
    }),
  );
}
