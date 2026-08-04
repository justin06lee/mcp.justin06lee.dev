import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SiteClient } from "../client.ts";
import { fail, guarded, ok } from "./shared.ts";

const CATEGORIES = ["projects", "hobbies", "in-development"] as const;

const categoryEnum = z.enum(CATEGORIES);

/** Row shape as the API returns it — `tech` arrives as a JSON-encoded string. */
type ItemRow = {
  id: string;
  category: string;
  title: string;
  description: string;
  year: number;
  tech: string;
  link: string | null;
  repo: string | null;
  live: string | null;
  notes: string | null;
  sort_order: number;
  pinned: number;
};

function decode(row: ItemRow) {
  let tech: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tech);
    if (Array.isArray(parsed)) tech = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    // A malformed tech blob shouldn't blank the whole listing — surface the raw value.
    tech = [row.tech];
  }
  return { ...row, tech, pinned: row.pinned === 1 };
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function registerItemTools(server: McpServer, client: SiteClient): void {
  server.registerTool(
    "list_items",
    {
      title: "List portfolio items",
      description:
        "List the projects / hobbies / in-development entries shown on justin06lee.dev. " +
        "Call this before updating or deleting so you have real ids.",
      inputSchema: {
        category: categoryEnum.optional().describe("Omit to list every category."),
      },
    },
    guarded(async ({ category }) => {
      const rows = await client.request<ItemRow[]>("/api/items", { query: { category } });
      return ok(rows.map(decode));
    }),
  );

  server.registerTool(
    "create_item",
    {
      title: "Create a portfolio item",
      description:
        "Add a new entry to projects, hobbies, or in-development. The id must be unique; " +
        "it is derived from the title when omitted.",
      inputSchema: {
        category: categoryEnum,
        title: z.string().min(1).max(200),
        description: z.string().min(1),
        year: z.number().int().min(1970).max(2200),
        tech: z.array(z.string()).describe("Technology tags, e.g. ['next.js', 'turso']."),
        id: z.string().min(1).optional().describe("URL-safe id. Defaults to a slug of the title."),
        link: z.string().optional(),
        repo: z.string().optional(),
        live: z.string().optional(),
        notes: z.string().optional(),
        sort_order: z.number().int().optional().describe("Lower sorts first within the category."),
        pinned: z.boolean().optional().describe("Pinned items sort above everything else."),
      },
    },
    guarded(async (args) => {
      const id = args.id ?? slugify(args.title);
      if (!id) return fail("Could not derive an id from that title — pass `id` explicitly.");

      const existing = await client.request<ItemRow[]>("/api/items");
      if (existing.some((row) => row.id === id)) {
        return fail(`An item with id "${id}" already exists. Pass a different \`id\`.`);
      }

      await client.request("/api/items", { method: "POST", body: { ...args, id } });
      return ok({ id }, `Created "${args.title}" in ${args.category}.`);
    }),
  );

  server.registerTool(
    "update_item",
    {
      title: "Update a portfolio item",
      description:
        "Change fields on an existing item. Only the fields you pass are modified — " +
        "the rest are carried over from the current record.",
      inputSchema: {
        id: z.string().min(1),
        category: categoryEnum.optional(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().min(1).optional(),
        year: z.number().int().min(1970).max(2200).optional(),
        tech: z.array(z.string()).optional(),
        link: z.string().nullable().optional(),
        repo: z.string().nullable().optional(),
        live: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        sort_order: z.number().int().optional(),
        pinned: z.boolean().optional(),
      },
    },
    guarded(async ({ id, ...patch }) => {
      // The site's PUT is a full replace: any field omitted from the body is
      // written as null. Read-modify-write turns it into the partial update the
      // caller expects, instead of silently blanking untouched columns.
      const rows = await client.request<ItemRow[]>("/api/items");
      const current = rows.find((row) => row.id === id);
      if (!current) {
        return fail(`No item with id "${id}". Use list_items to see valid ids.`);
      }

      const merged = { ...decode(current), ...patch };
      await client.request(`/api/items/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: {
          category: merged.category,
          title: merged.title,
          description: merged.description,
          year: merged.year,
          tech: merged.tech,
          link: merged.link,
          repo: merged.repo,
          live: merged.live,
          notes: merged.notes,
          sort_order: merged.sort_order,
          pinned: merged.pinned,
        },
      });
      return ok(merged, `Updated "${merged.title}".`);
    }),
  );

  server.registerTool(
    "move_item",
    {
      title: "Move an item to another category",
      description:
        "Move an item between projects / hobbies / in-development. This also re-packs the " +
        "sort order of both categories, which a plain update_item would not.",
      inputSchema: {
        id: z.string().min(1),
        target: categoryEnum,
      },
    },
    guarded(async ({ id, target }) => {
      await client.request(`/api/items/${encodeURIComponent(id)}/move`, {
        method: "POST",
        body: { target },
      });
      return ok({ id, target }, `Moved "${id}" to ${target}.`);
    }),
  );

  server.registerTool(
    "delete_item",
    {
      title: "Delete a portfolio item",
      description: "Permanently remove an item. There is no undo — confirm the id first.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) => {
      const rows = await client.request<ItemRow[]>("/api/items");
      const current = rows.find((row) => row.id === id);
      if (!current) return fail(`No item with id "${id}" — nothing deleted.`);

      await client.request(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
      return ok({ id }, `Deleted "${current.title}".`);
    }),
  );
}
