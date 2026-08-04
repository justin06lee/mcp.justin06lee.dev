import { z } from "zod";
import { ApiError } from "../client.ts";

/** Mirrors the site's own validation limits so bad input fails here, not over the wire. */
export const MAX_TITLE_LEN = 200;
export const MAX_NOTES_LEN = 10_000;
export const MAX_NAME_LEN = 80;
export const MAX_RANGE_DAYS = 400;
export const PRIMARY_TRACK = 0;
export const MAX_TRACK = 7;

/** The site rejects any category colour outside this palette. */
export const CATEGORY_PALETTE = [
  { name: "slate-blue", hex: "#5b7a8a" },
  { name: "taupe", hex: "#7a6b5b" },
  { name: "sage", hex: "#6b8a72" },
  { name: "plum", hex: "#7a5b78" },
  { name: "ochre", hex: "#8a7a5b" },
  { name: "terracotta", hex: "#8a6655" },
  { name: "fog", hex: "#7a8085" },
  { name: "indigo", hex: "#5b5b8a" },
] as const;

export const PALETTE_HEXES = CATEGORY_PALETTE.map((c) => c.hex);
export const PALETTE_HINT = CATEGORY_PALETTE.map((c) => `${c.hex} (${c.name})`).join(", ");

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (24h)");

/**
 * Epoch milliseconds, bounded to the same 2001..2100 window the site enforces.
 * A seconds-precision timestamp passed by mistake lands in 1970 and would be
 * rejected server-side anyway — catching it here gives a far clearer message.
 */
export const epochMs = z
  .number()
  .int()
  .min(978_307_200_000, "must be epoch MILLISECONDS (looks like seconds?)")
  .max(4_102_444_800_000, "must be epoch milliseconds before year 2100");

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function ok(data: unknown, note?: string): ToolResult {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: note ? `${note}\n\n${body}` : body }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wraps a handler so transport/API errors come back as readable tool errors
 * rather than crashing the server. The status-specific hints exist because the
 * raw API messages ("in-use", "concurrent-start") are terse enough to be
 * misleading on their own.
 */
export function guarded<A>(
  handler: (args: A) => Promise<ToolResult>,
): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (error) {
      if (error instanceof ApiError) {
        const hint =
          error.status === 404
            ? " — no record with that id. List first to get a current id."
            : error.status === 409
              ? " — conflict: the record is in use, a duplicate, or a timer is already running on that track."
              : error.status === 429
                ? " — rate limited (200 writes/min per IP). Slow down and retry."
                : "";
        return fail(`${error.message}${hint}`);
      }
      if (error instanceof Error && error.name === "TimeoutError") {
        return fail("Request timed out. Is SITE_URL reachable? Raise REQUEST_TIMEOUT_MS if the site is cold-starting.");
      }
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
}

/** Reject ranges the site would refuse, with a message that says what to do. */
export function checkRange(from: string, to: string): string | null {
  if (to < from) return `'to' (${to}) is before 'from' (${from}).`;
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span > MAX_RANGE_DAYS) {
    return `Range spans ${Math.round(span)} days; the site caps it at ${MAX_RANGE_DAYS}. Query in chunks.`;
  }
  return null;
}
