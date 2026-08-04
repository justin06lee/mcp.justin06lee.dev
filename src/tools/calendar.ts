import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../client.ts";
import {
  MAX_NAME_LEN,
  MAX_NOTES_LEN,
  MAX_TITLE_LEN,
  PALETTE_HEXES,
  PALETTE_HINT,
  checkRange,
  dateString,
  fail,
  guarded,
  hhmm,
  ok,
} from "./shared.ts";

const fallback = z.object({
  categoryId: z.string().min(1),
  title: z.string().min(1).max(MAX_TITLE_LEN),
  startTime: hhmm,
  endTime: hhmm,
});

export function registerCalendarTools(server: McpServer, client: SiteClient): void {
  /* ── planned tasks ── */

  server.registerTool(
    "list_calendar_tasks",
    {
      title: "List planned calendar tasks",
      description:
        "Read planned tasks in a date range. These are intentions — what was actually " +
        "spent is tracked separately by the timer tools.",
      inputSchema: {
        from: dateString.describe("Inclusive start, YYYY-MM-DD."),
        to: dateString.describe("Inclusive end, YYYY-MM-DD. Max 400 days from `from`."),
      },
    },
    guarded(async ({ from, to }) => {
      const rangeError = checkRange(from, to);
      if (rangeError) return fail(rangeError);
      return ok(await client.request("/api/calendar/tasks", { query: { from, to } }));
    }),
  );

  server.registerTool(
    "create_calendar_task",
    {
      title: "Create a planned calendar task",
      description: "Add a task to a specific day, optionally with a time slot and category.",
      inputSchema: {
        date: dateString,
        title: z.string().min(1).max(MAX_TITLE_LEN),
        notes: z.string().max(MAX_NOTES_LEN).optional(),
        startTime: hhmm.optional().describe("Omit for an untimed to-do on that day."),
        endTime: hhmm.optional(),
        categoryId: z.string().min(1).optional().describe("From list_calendar_categories."),
        position: z.number().int().optional().describe("Order within the day."),
        isUncertain: z
          .boolean()
          .optional()
          .describe("Marks the plan as tentative; pairs with `fallbacks`."),
        fallbacks: z
          .array(fallback)
          .optional()
          .describe("Alternative plans for the same slot. Each needs a category and a time range."),
      },
    },
    guarded(async (args) => ok(await client.request("/api/calendar/tasks", { method: "POST", body: args }))),
  );

  server.registerTool(
    "update_calendar_task",
    {
      title: "Update a planned calendar task",
      description:
        "Change any field on a planned task, including marking it done or moving it to " +
        "another day. Only the fields you pass are modified.",
      inputSchema: {
        id: z.string().min(1),
        title: z.string().min(1).max(MAX_TITLE_LEN).optional(),
        notes: z.string().max(MAX_NOTES_LEN).nullable().optional(),
        startTime: hhmm.nullable().optional(),
        endTime: hhmm.nullable().optional(),
        date: dateString.optional().describe("Set to reschedule the task to another day."),
        done: z.boolean().optional(),
        position: z.number().int().optional(),
        categoryId: z.string().min(1).nullable().optional(),
        isUncertain: z.boolean().optional(),
        fallbacks: z.array(fallback).nullable().optional().describe("null clears all fallbacks."),
      },
    },
    guarded(async ({ id, ...patch }) =>
      ok(
        await client.request(`/api/calendar/tasks/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      ),
    ),
  );

  server.registerTool(
    "delete_calendar_task",
    {
      title: "Delete a planned calendar task",
      description: "Permanently remove a planned task. Does not touch logged time entries.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) => {
      await client.request(`/api/calendar/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      return ok({ id }, "Deleted planned task.");
    }),
  );

  /* ── categories ── */

  server.registerTool(
    "list_calendar_categories",
    {
      title: "List calendar categories",
      description:
        "List the categories tasks and time entries are filed under. Call this to get " +
        "valid categoryId values before creating either.",
      inputSchema: {},
    },
    guarded(async () => ok(await client.request("/api/calendar/categories"))),
  );

  server.registerTool(
    "create_calendar_category",
    {
      title: "Create a calendar category",
      description: `Add a category. Colour must come from the site palette: ${PALETTE_HINT}.`,
      inputSchema: {
        name: z.string().min(1).max(MAX_NAME_LEN),
        color: z.enum(PALETTE_HEXES as [string, ...string[]]).describe(PALETTE_HINT),
      },
    },
    guarded(async (args) =>
      ok(await client.request("/api/calendar/categories", { method: "POST", body: args })),
    ),
  );

  server.registerTool(
    "update_calendar_category",
    {
      title: "Update a calendar category",
      description:
        "Rename, recolour, reorder, or archive a category. System categories (e.g. Sleep) " +
        "cannot be renamed.",
      inputSchema: {
        id: z.string().min(1),
        name: z.string().min(1).max(MAX_NAME_LEN).optional(),
        color: z.enum(PALETTE_HEXES as [string, ...string[]]).optional().describe(PALETTE_HINT),
        archived: z
          .boolean()
          .optional()
          .describe("Archiving hides it from pickers but keeps historical entries intact."),
        position: z.number().int().optional(),
      },
    },
    guarded(async ({ id, ...patch }) =>
      ok(
        await client.request(`/api/calendar/categories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      ),
    ),
  );

  server.registerTool(
    "delete_calendar_category",
    {
      title: "Delete a calendar category",
      description:
        "Delete a category. Fails if any task or time entry still references it — archive " +
        "it instead to retire a category without losing history.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) => {
      await client.request(`/api/calendar/categories/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      return ok({ id }, "Deleted category.");
    }),
  );
}
