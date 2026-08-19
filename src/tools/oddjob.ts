import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient, RawResponse } from "../client.ts";
import { fail, guarded, ok } from "./shared.ts";

/** Mirrors oddjob's status allowlist (src/lib/work-order.ts). */
const STATUSES = ["received", "reading", "quoted", "building", "done", "declined"] as const;

const statusEnum = z.enum(STATUSES);

/** Text formats come back inline; everything else needs a save path. */
const INLINE_MIMES = /^text\/(plain|markdown)/;
const MAX_INLINE_BYTES = 256 * 1024;

/**
 * oddjob.justin06lee.dev — the work-order inbox. Same shared ADMIN_KEY as the
 * main site, its own oddjob_admin_session cookie. `id` arguments accept either
 * the row id or the human reference ("OJ-0042", case-insensitive).
 */
export function registerOddjobTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "oddjob_list_requests",
    {
      title: "List oddjob work requests",
      description:
        "Read the work-order inbox (newest first). Rows carry the request fields, status, " +
        "admin notes, and attachment metadata (never the file itself).",
      inputSchema: {
        status: statusEnum.optional().describe("Filter to one status."),
        limit: z.number().int().min(1).max(100).optional().describe("Default 15, max 100."),
        offset: z.number().int().min(0).optional(),
      },
    },
    guarded(async ({ status, limit, offset }) =>
      ok(await client.request("/api/requests", { query: { status, limit, offset } })),
    ),
  );

  server.registerTool(
    "oddjob_get_request",
    {
      title: "Read an oddjob work request",
      description:
        "Read one request in full, including attachment metadata. `id` is the row id or " +
        "the reference ('OJ-0042').",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) =>
      ok(await client.request(`/api/requests/${encodeURIComponent(id)}`)),
    ),
  );

  server.registerTool(
    "oddjob_update_request",
    {
      title: "Update an oddjob work request",
      description:
        `Set the status (${STATUSES.join(" → ")}) and/or the private admin notes. ` +
        "An empty-string adminNotes clears the notes.",
      inputSchema: {
        id: z.string().min(1).describe("Row id or reference ('OJ-0042')."),
        status: statusEnum.optional(),
        adminNotes: z.string().optional().describe("Empty string clears the notes."),
      },
    },
    guarded(async ({ id, status, adminNotes }) => {
      if (status === undefined && adminNotes === undefined) {
        return fail("Pass `status`, `adminNotes`, or both — nothing to update otherwise.");
      }
      return ok(
        await client.request(`/api/requests/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { status, adminNotes },
        }),
      );
    }),
  );

  server.registerTool(
    "oddjob_delete_request",
    {
      title: "Delete an oddjob work request",
      description:
        "Permanently delete a request AND its attachment. There is no undo — confirm with " +
        "the user first.",
      inputSchema: { id: z.string().min(1).describe("Row id or reference ('OJ-0042').") },
    },
    guarded(async ({ id }) =>
      ok(await client.request(`/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" })),
    ),
  );

  server.registerTool(
    "oddjob_get_attachment",
    {
      title: "Download an oddjob attachment",
      description:
        "Fetch a request's attached file. The attachment id comes from the request's " +
        "attachment metadata (NOT the request id). Plain-text and markdown files are " +
        "returned inline; anything else (pdf/doc) needs `save_path`.",
      inputSchema: {
        id: z.string().min(1).describe("The attachment id from oddjob_get_request."),
        save_path: z
          .string()
          .min(1)
          .optional()
          .describe("Local file path to save the bytes to. Required for non-text files."),
      },
    },
    guarded(async ({ id, save_path }) => {
      // The attachment route 404s for both "no session" and "no such file" (so
      // it never confirms its own existence to anonymous probers). Touch the
      // auth probe first — it heals an expired session via the client's single
      // re-login — so a 404 below truthfully means the attachment is gone.
      await client.request("/api/auth");

      let file: RawResponse;
      try {
        file = await client.request<RawResponse>(`/admin/attachment/${encodeURIComponent(id)}`, {
          raw: true,
        });
      } catch {
        return fail(
          `No attachment with id "${id}". The id comes from the request's attachment ` +
            "metadata (oddjob_get_request), not the request id itself.",
        );
      }

      const mime = file.contentType ?? "application/octet-stream";

      if (save_path) {
        await writeFile(save_path, file.bytes);
        return ok({ path: save_path, bytes: file.bytes.length, mime }, "Saved attachment.");
      }

      if (!INLINE_MIMES.test(mime)) {
        return fail(
          `The attachment is ${mime} (${file.bytes.length} bytes) — pass \`save_path\` to ` +
            "write it to disk instead of reading it inline.",
        );
      }
      if (file.bytes.length > MAX_INLINE_BYTES) {
        return fail(
          `The attachment is ${file.bytes.length} bytes — too large to return inline. ` +
            "Pass `save_path` to write it to disk.",
        );
      }
      return ok(new TextDecoder().decode(file.bytes), `Attachment ${id} (${mime}):`);
    }),
  );
}
