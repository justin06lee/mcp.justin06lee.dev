import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import { guarded, ok } from "./shared.ts";

type SiteConfig = {
  description: string[];
  socials: Record<string, string>;
  pfp: { url: string; scale: number; x: number; y: number };
  prayerLocation: {
    city: string;
    country: string;
    method: number;
    timezone: string;
    latitude: number | null;
    longitude: number | null;
  };
};

export function registerSiteConfigTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "get_site_config",
    {
      title: "Get site configuration",
      description:
        "Read the homepage bio lines, social links, profile-picture framing, and the " +
        "location that drives prayer times and the calendar's timezone.",
      inputSchema: {},
    },
    guarded(async () => ok(await client.request<SiteConfig>("/api/config"))),
  );

  server.registerTool(
    "update_site_config",
    {
      title: "Update site configuration",
      description:
        "Change homepage bio text, socials, profile picture framing, or location. " +
        "Only the sections you pass are touched, but each section you do pass is replaced " +
        "wholesale — read get_site_config first and send back the complete section.",
      inputSchema: {
        description: z
          .array(z.string())
          .optional()
          .describe("Homepage bio, one string per paragraph. Replaces all existing lines."),
        socials: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Social links keyed by network (github, linkedin, x, email, instagram). " +
              "Replaces the whole object — include every link you want to keep.",
          ),
        pfp: z
          .object({
            url: z.string(),
            scale: z.number(),
            x: z.number(),
            y: z.number(),
          })
          .optional()
          .describe("Profile picture source and framing. All four fields are required together."),
        prayerLocation: z
          .object({
            city: z.string(),
            country: z.string(),
            method: z.number().int().describe("Prayer-time calculation method id."),
            timezone: z.string().describe("IANA zone, e.g. 'America/New_York'."),
            latitude: z.number().min(-90).max(90).nullable(),
            longitude: z.number().min(-180).max(180).nullable(),
          })
          .optional()
          .describe(
            "Also sets the timezone the calendar and timers file entries under. " +
              "All fields are required together.",
          ),
      },
    },
    guarded(async (patch) => {
      const sections = Object.keys(patch).filter(
        (key) => patch[key as keyof typeof patch] !== undefined,
      );
      if (sections.length === 0) {
        return ok(
          await client.request<SiteConfig>("/api/config"),
          "No fields passed — nothing changed. Current config:",
        );
      }

      await client.request("/api/config", { method: "PUT", body: patch });
      return ok(
        await client.request<SiteConfig>("/api/config"),
        `Updated: ${sections.join(", ")}. Config now:`,
      );
    }),
  );

  server.registerTool(
    "reverse_geocode",
    {
      title: "Reverse-geocode coordinates",
      description:
        "Turn latitude/longitude into a {city, country} pair via the site's geocoding " +
        "proxy. Useful before updating prayerLocation in update_site_config.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      },
    },
    guarded(async ({ lat, lon }) =>
      ok(await client.request("/api/geocode/reverse", { query: { lat, lon } })),
    ),
  );

  server.registerTool(
    "get_pats",
    {
      title: "Get the head-pat count",
      description:
        "Read the site's global cat head-pat counter. Read-only: pats are given through " +
        "the site itself, not through this server.",
      inputSchema: {},
    },
    guarded(async () => ok(await client.request("/api/pats"))),
  );
}
