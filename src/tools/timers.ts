import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import {
  MAX_NOTES_LEN,
  MAX_TITLE_LEN,
  MAX_TRACK,
  PRIMARY_TRACK,
  checkRange,
  dateString,
  epochMs,
  fail,
  guarded,
  ok,
} from "./shared.ts";

const track = z
  .number()
  .int()
  .min(PRIMARY_TRACK)
  .max(MAX_TRACK)
  .describe(
    `Parallel lane ${PRIMARY_TRACK}-${MAX_TRACK}. Omit for the primary lane. ` +
      "Lanes let several activities run at once.",
  );

export function registerTimerTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "get_running_timers",
    {
      title: "Get running timers",
      description:
        "Show every timer currently running, across all lanes. Returns an empty list when " +
        "nothing is being tracked.",
      inputSchema: {},
    },
    guarded(async () => {
      const result = await client.request<{ running: unknown[] }>("/api/calendar/actuals/running", {
        query: { all: "1" },
      });
      const running = result?.running ?? [];
      return running.length === 0 ? ok([], "No timers running.") : ok(running);
    }),
  );

  server.registerTool(
    "start_timer",
    {
      title: "Start a timer",
      description:
        "Start tracking time now. Fails with a conflict if that lane is already occupied — " +
        "check get_running_timers first, or stop the existing one.",
      inputSchema: {
        title: z.string().max(MAX_TITLE_LEN).optional().describe("What is being worked on."),
        categoryId: z.string().min(1).optional().describe("From list_calendar_categories."),
        planId: z
          .string()
          .min(1)
          .optional()
          .describe("Links this session to a planned task, so plan vs. actual can be compared."),
        track: track.optional(),
      },
    },
    guarded(async (args) =>
      ok(await client.request("/api/calendar/actuals/start", { method: "POST", body: args })),
    ),
  );

  server.registerTool(
    "stop_timer",
    {
      title: "Stop a timer",
      description:
        "Stop a running timer. With no arguments it stops the primary lane only. Use `all` " +
        "to stop everything, or `id`/`track` to target one.",
      inputSchema: {
        id: z.string().min(1).optional().describe("Stop this specific running entry."),
        track: track.optional(),
        all: z.boolean().optional().describe("Stop every running timer on every lane."),
      },
    },
    guarded(async ({ id, track: lane, all }) => {
      // The site treats an omitted track as the primary lane, never as "all", so
      // these stay mutually exclusive rather than being merged into one body.
      const body = all ? { all: true } : id ? { id } : lane !== undefined ? { track: lane } : {};
      return ok(await client.request("/api/calendar/actuals/stop", { method: "POST", body }));
    }),
  );

  server.registerTool(
    "list_time_entries",
    {
      title: "List logged time entries",
      description:
        "Read tracked time in a date range — what was actually done, as opposed to the " +
        "planned tasks from list_calendar_tasks.",
      inputSchema: {
        from: dateString.describe("Inclusive start, YYYY-MM-DD."),
        to: dateString.describe("Inclusive end, YYYY-MM-DD. Max 400 days from `from`."),
      },
    },
    guarded(async ({ from, to }) => {
      const rangeError = checkRange(from, to);
      if (rangeError) return fail(rangeError);
      return ok(await client.request("/api/calendar/actuals", { query: { from, to } }));
    }),
  );

  server.registerTool(
    "create_time_entry",
    {
      title: "Log a completed time entry",
      description:
        "Record time after the fact, for work that was never timed live. Timestamps are " +
        "epoch milliseconds; the day it files under is derived from the site's timezone. " +
        "Backfilled entries always land on the primary lane — the API has no track field here.",
      inputSchema: {
        startAt: epochMs,
        endAt: epochMs,
        title: z.string().max(MAX_TITLE_LEN).optional(),
        categoryId: z.string().min(1).optional(),
        planId: z.string().min(1).optional().describe("Links the entry to a planned task."),
        notes: z.string().max(MAX_NOTES_LEN).optional(),
      },
    },
    guarded(async (args) => {
      if (args.endAt <= args.startAt) {
        return fail(`endAt (${args.endAt}) must be after startAt (${args.startAt}).`);
      }
      return ok(await client.request("/api/calendar/actuals", { method: "POST", body: args }));
    }),
  );

  server.registerTool(
    "update_time_entry",
    {
      title: "Update a logged time entry",
      description:
        "Correct a logged entry's times, title, category, or notes. Only the fields you " +
        "pass are modified.",
      inputSchema: {
        id: z.string().min(1),
        startAt: epochMs.optional(),
        endAt: epochMs.nullable().optional().describe("null leaves the entry running."),
        title: z.string().max(MAX_TITLE_LEN).nullable().optional(),
        categoryId: z.string().min(1).nullable().optional(),
        notes: z.string().max(MAX_NOTES_LEN).nullable().optional(),
      },
    },
    guarded(async ({ id, ...patch }) => {
      if (
        patch.startAt !== undefined &&
        patch.endAt !== undefined &&
        patch.endAt !== null &&
        patch.endAt <= patch.startAt
      ) {
        return fail(`endAt (${patch.endAt}) must be after startAt (${patch.startAt}).`);
      }
      return ok(
        await client.request(`/api/calendar/actuals/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      );
    }),
  );

  server.registerTool(
    "delete_time_entry",
    {
      title: "Delete a logged time entry",
      description: "Permanently remove a tracked time entry.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) => {
      await client.request(`/api/calendar/actuals/${encodeURIComponent(id)}`, { method: "DELETE" });
      return ok({ id }, "Deleted time entry.");
    }),
  );
}
