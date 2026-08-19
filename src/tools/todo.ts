import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import { PALETTE_HEXES, PALETTE_HINT, guarded, ok } from "./shared.ts";

/** Mirrors todo's own caps (lib/validate.ts) so bad input fails locally. */
const MAX_CATEGORY_NAME_LEN = 60;
const MAX_TASK_TITLE_LEN = 200;
const MAX_NOTE_TITLE_LEN = 120;
const MAX_NOTE_CONTENT_LEN = 200_000;

/**
 * todo.justin06lee.dev — the todo board + notes. Same shared ADMIN_KEY as the
 * main site, its own admin_session cookie. Ids are UUIDs minted by the site;
 * category colours come from the same 8-hex palette the calendar uses.
 */
export function registerTodoTools(server: McpServer, client: ApiClient): void {
  /* ── board ── */

  server.registerTool(
    "todo_get_board",
    {
      title: "Get the todo board",
      description:
        "Read the whole board: every category (including private ones) with its tasks. " +
        "Call this before updating or deleting to get real ids.",
      inputSchema: {},
    },
    guarded(async () => ok(await client.request("/api/board"))),
  );

  server.registerTool(
    "todo_create_category",
    {
      title: "Create a todo category",
      description: `Add a board category. Colour must come from the site palette: ${PALETTE_HINT}.`,
      inputSchema: {
        name: z.string().min(1).max(MAX_CATEGORY_NAME_LEN),
        color: z.enum(PALETTE_HEXES as [string, ...string[]]).describe(PALETTE_HINT),
        isPublic: z
          .boolean()
          .optional()
          .describe("Private categories (false) are hidden from anonymous visitors. Default true."),
      },
    },
    guarded(async (args) =>
      ok(await client.request("/api/categories", { method: "POST", body: args })),
    ),
  );

  server.registerTool(
    "todo_update_category",
    {
      title: "Update a todo category",
      description: "Rename, recolour, or change the visibility of a category.",
      inputSchema: {
        id: z.string().min(1),
        name: z.string().min(1).max(MAX_CATEGORY_NAME_LEN).optional(),
        color: z.enum(PALETTE_HEXES as [string, ...string[]]).optional().describe(PALETTE_HINT),
        isPublic: z.boolean().optional(),
      },
    },
    guarded(async ({ id, ...patch }) =>
      ok(
        await client.request(`/api/categories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      ),
    ),
  );

  server.registerTool(
    "todo_delete_category",
    {
      title: "Delete a todo category",
      description:
        "Permanently delete a category AND every task in it. There is no undo — confirm " +
        "with the user first.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) =>
      ok(await client.request(`/api/categories/${encodeURIComponent(id)}`, { method: "DELETE" })),
    ),
  );

  server.registerTool(
    "todo_clear_done_tasks",
    {
      title: "Clear a category's done tasks",
      description: "Permanently remove every completed task in one category.",
      inputSchema: { categoryId: z.string().min(1) },
    },
    guarded(async ({ categoryId }) =>
      ok(
        await client.request(`/api/categories/${encodeURIComponent(categoryId)}/clear-done`, {
          method: "POST",
        }),
      ),
    ),
  );

  server.registerTool(
    "todo_create_task",
    {
      title: "Create a todo task",
      description: "Add a task to a category. categoryId comes from todo_get_board.",
      inputSchema: {
        categoryId: z.string().min(1),
        title: z.string().min(1).max(MAX_TASK_TITLE_LEN),
      },
    },
    guarded(async (args) => ok(await client.request("/api/tasks", { method: "POST", body: args }))),
  );

  server.registerTool(
    "todo_update_task",
    {
      title: "Update a todo task",
      description: "Rename a task or mark it done / not done.",
      inputSchema: {
        id: z.string().min(1),
        title: z.string().min(1).max(MAX_TASK_TITLE_LEN).optional(),
        done: z.boolean().optional(),
      },
    },
    guarded(async ({ id, ...patch }) =>
      ok(
        await client.request(`/api/tasks/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      ),
    ),
  );

  server.registerTool(
    "todo_delete_task",
    {
      title: "Delete a todo task",
      description: "Permanently remove one task.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) =>
      ok(await client.request(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" })),
    ),
  );

  /* ── notes ── */

  server.registerTool(
    "todo_list_notes",
    {
      title: "List todo notes",
      description:
        "List every note (including private ones) — id, title, visibility, timestamps. " +
        "Bodies are not included; read one with todo_read_note.",
      inputSchema: {},
    },
    guarded(async () => ok(await client.request("/api/notes"))),
  );

  server.registerTool(
    "todo_read_note",
    {
      title: "Read a todo note",
      description: "Read one note in full, content included.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) =>
      ok(await client.request(`/api/notes/${encodeURIComponent(id)}`)),
    ),
  );

  server.registerTool(
    "todo_create_note",
    {
      title: "Create a todo note",
      description:
        "Create a note. Untitled and empty by default — pass title/content to fill it in " +
        "one call. Notes are public unless isPublic is false.",
      inputSchema: {
        title: z.string().min(1).max(MAX_NOTE_TITLE_LEN).optional().describe("Default 'untitled'."),
        content: z.string().max(MAX_NOTE_CONTENT_LEN).optional(),
        isPublic: z.boolean().optional(),
      },
    },
    guarded(async (args) => ok(await client.request("/api/notes", { method: "POST", body: args }))),
  );

  server.registerTool(
    "todo_update_note",
    {
      title: "Update a todo note",
      description:
        "Change a note's title, content, or visibility. `content` replaces the whole body — " +
        "read it first with todo_read_note when editing rather than overwriting.",
      inputSchema: {
        id: z.string().min(1),
        title: z.string().min(1).max(MAX_NOTE_TITLE_LEN).optional(),
        content: z.string().max(MAX_NOTE_CONTENT_LEN).optional(),
        isPublic: z.boolean().optional(),
      },
    },
    guarded(async ({ id, ...patch }) =>
      ok(
        await client.request(`/api/notes/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      ),
    ),
  );

  server.registerTool(
    "todo_delete_note",
    {
      title: "Delete a todo note",
      description: "Permanently remove a note. There is no undo — confirm the id first.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) =>
      ok(await client.request(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" })),
    ),
  );
}
