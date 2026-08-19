import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import { checkRange, dateString, fail, guarded, ok } from "./shared.ts";

/** Mirrors coffee's own caps (src/lib/admin-input.ts) so bad input fails locally. */
const MAX_REASON_LEN = 500;
const MINUTES_IN_DAY = 24 * 60;

const minuteOfDay = z.number().int().min(0).max(MINUTES_IN_DAY);

const weeklyRule = z.object({
  weekday: z.number().int().min(0).max(6).describe("0 = Sunday … 6 = Saturday."),
  startMin: minuteOfDay.describe("Window start, minutes after midnight (site timezone)."),
  endMin: minuteOfDay.describe("Window end, minutes after midnight. Must exceed startMin."),
});

const eventTypeFields = {
  title: z.string().min(1).max(80),
  slug: z.string().optional().describe("URL slug; derived from the title when omitted."),
  blurb: z.string().max(300).nullable().optional(),
  durationMin: z.number().int().min(5).max(480).optional().describe("Default 30."),
  incrementMin: z.number().int().min(5).max(240).optional().describe("Slot grid step. Default 15."),
  bufferBeforeMin: z.number().int().min(0).max(240).optional(),
  bufferAfterMin: z.number().int().min(0).max(240).optional(),
  minNoticeMin: z
    .number()
    .int()
    .min(0)
    .max(43_200)
    .optional()
    .describe("Minimum lead time in minutes. Default 720 (12h)."),
  maxDaysAhead: z.number().int().min(1).max(365).optional().describe("Booking horizon. Default 45."),
  dailyLimit: z
    .number()
    .int()
    .min(1)
    .nullable()
    .optional()
    .describe("Max bookings of this type per day; null for no limit."),
  location: z.string().max(40).optional().describe("Default 'video'."),
  locationDetail: z.string().max(200).nullable().optional(),
  active: z
    .boolean()
    .optional()
    .describe("IMPORTANT: defaults to false on create — pass true to make it bookable."),
};

/**
 * coffee.justin06lee.dev — the personal booking page. Same shared ADMIN_KEY as
 * the main site, its own coffee_admin_session cookie. All availability times
 * are minutes-after-midnight in the timezone from coffee_get_settings.
 */
export function registerCoffeeTools(server: McpServer, client: ApiClient): void {
  /* ── bookings ── */

  server.registerTool(
    "coffee_list_bookings",
    {
      title: "List coffee bookings",
      description:
        "Read bookings (newest start first). Each row carries the guest, the slot " +
        "(epoch ms), status, and the cancelToken whose URL is the guest's cancel link.",
      inputSchema: {
        status: z.enum(["confirmed", "cancelled"]).optional(),
        from: dateString.optional().describe("Inclusive start day, YYYY-MM-DD."),
        to: dateString.optional().describe("Inclusive end day. Max 400 days from `from`."),
        limit: z.number().int().min(1).max(200).optional().describe("Default 50."),
        offset: z.number().int().min(0).optional(),
      },
    },
    guarded(async ({ status, from, to, limit, offset }) => {
      if (from && to) {
        const rangeError = checkRange(from, to);
        if (rangeError) return fail(rangeError);
      }
      return ok(
        await client.request("/api/bookings", { query: { status, from, to, limit, offset } }),
      );
    }),
  );

  server.registerTool(
    "coffee_get_booking",
    {
      title: "Read a coffee booking",
      description: "Read one booking in full. Ids come from coffee_list_bookings.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) =>
      ok(await client.request(`/api/bookings/${encodeURIComponent(id)}`)),
    ),
  );

  server.registerTool(
    "coffee_cancel_booking",
    {
      title: "Cancel a coffee booking",
      description:
        "Cancel a booking as the host. The slot opens up again and the guest's page shows " +
        "the cancellation (with the reason, if given). Idempotent on already-cancelled " +
        "bookings. Confirm with the user first.",
      inputSchema: {
        id: z.string().min(1),
        reason: z.string().max(MAX_REASON_LEN).optional(),
      },
    },
    guarded(async ({ id, reason }) =>
      ok(
        await client.request(`/api/bookings/${encodeURIComponent(id)}/cancel`, {
          method: "POST",
          body: { reason },
        }),
      ),
    ),
  );

  /* ── event types ── */

  server.registerTool(
    "coffee_list_event_types",
    {
      title: "List coffee event types",
      description:
        "List every meeting type (active and inactive) with its full slot configuration.",
      inputSchema: {},
    },
    guarded(async () => ok(await client.request("/api/event-types"))),
  );

  server.registerTool(
    "coffee_create_event_type",
    {
      title: "Create a coffee event type",
      description:
        "Add a bookable meeting type. NOTE: it is created INACTIVE unless you pass " +
        "`active: true` — an inactive type never shows on the booking page.",
      inputSchema: eventTypeFields,
    },
    guarded(async (args) =>
      ok(await client.request("/api/event-types", { method: "POST", body: args })),
    ),
  );

  server.registerTool(
    "coffee_update_event_type",
    {
      title: "Update a coffee event type",
      description:
        "Change fields on an event type. Only the fields you pass are modified — the " +
        "merge happens server-side. Returns the stored row.",
      inputSchema: {
        id: z.string().min(1),
        ...eventTypeFields,
        title: eventTypeFields.title.optional(),
      },
    },
    guarded(async ({ id, ...patch }) =>
      ok(
        await client.request(`/api/event-types/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      ),
    ),
  );

  server.registerTool(
    "coffee_delete_event_type",
    {
      title: "Delete a coffee event type",
      description:
        "Delete an event type. Refused (409) while bookings exist against it — set " +
        "`active: false` instead to retire it without touching history.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) =>
      ok(await client.request(`/api/event-types/${encodeURIComponent(id)}`, { method: "DELETE" })),
    ),
  );

  /* ── availability ── */

  server.registerTool(
    "coffee_get_availability",
    {
      title: "Get coffee availability",
      description:
        "Read the weekly recurring windows and the per-date overrides. Times are minutes " +
        "after midnight in the timezone from coffee_get_settings.",
      inputSchema: {},
    },
    guarded(async () => ok(await client.request("/api/availability"))),
  );

  server.registerTool(
    "coffee_set_weekly_availability",
    {
      title: "Replace the weekly availability",
      description:
        "FULL REPLACE of every recurring weekly window — the given list becomes the whole " +
        "schedule. Read coffee_get_availability first and resend the windows you want to " +
        "keep. An empty list closes every week entirely.",
      inputSchema: {
        rules: z.array(weeklyRule).describe("The complete new set of weekly windows."),
      },
    },
    guarded(async ({ rules }) =>
      ok(
        await client.request("/api/availability/weekly", { method: "PUT", body: { rules } }),
        `Weekly availability replaced (${rules.length} window(s)).`,
      ),
    ),
  );

  server.registerTool(
    "coffee_add_date_override",
    {
      title: "Add a coffee date override",
      description:
        "Override one date: with no window (or blocked: true) the whole day is blocked; " +
        "with startMin/endMin that window replaces the weekly schedule for that date. " +
        "Replaces any existing override on the same date.",
      inputSchema: {
        date: dateString,
        blocked: z.boolean().optional(),
        startMin: minuteOfDay.optional(),
        endMin: minuteOfDay.optional(),
        note: z.string().max(200).optional(),
      },
    },
    guarded(async (args) =>
      ok(await client.request("/api/availability/overrides", { method: "POST", body: args })),
    ),
  );

  server.registerTool(
    "coffee_remove_date_override",
    {
      title: "Remove a coffee date override",
      description: "Remove one date override (ids come from coffee_get_availability).",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) =>
      ok(
        await client.request(`/api/availability/overrides/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      ),
    ),
  );

  /* ── settings ── */

  server.registerTool(
    "coffee_get_settings",
    {
      title: "Get coffee settings",
      description:
        "Read the host settings: timezone, host name/bio, default location, whether " +
        "bookings are open, and the closed message.",
      inputSchema: {},
    },
    guarded(async () => ok(await client.request("/api/settings"))),
  );

  server.registerTool(
    "coffee_update_settings",
    {
      title: "Update coffee settings",
      description:
        "Change host settings. Only the fields you pass are modified. `bookingsOpen: false` " +
        "turns the whole booking page off without deleting anything.",
      inputSchema: {
        timeZone: z.string().optional().describe("IANA zone; invalid zones are rejected."),
        hostName: z.string().max(80).optional(),
        hostBio: z.string().max(400).optional(),
        defaultLocation: z.string().max(200).optional(),
        bookingsOpen: z.boolean().optional(),
        closedMessage: z.string().max(300).optional(),
      },
    },
    guarded(async (patch) => {
      if (Object.values(patch).every((v) => v === undefined)) {
        return ok(await client.request("/api/settings"), "No fields passed — current settings:");
      }
      return ok(await client.request("/api/settings", { method: "PUT", body: patch }));
    }),
  );
}
