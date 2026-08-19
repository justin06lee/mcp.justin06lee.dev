import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import { fail, guarded, ok, type ToolResult } from "./shared.ts";

const difficulty = z.enum(["easy", "medium", "hard"]);
const judgingMode = z.enum(["function", "stdio"]);
const testKind = z.enum(["visible", "hidden"]);

const param = z.object({ name: z.string().min(1), type: z.string().min(1) });

const test = z.object({
  kind: testKind,
  input: z.string(),
  expected: z.string(),
});

/**
 * leet.justin06lee.dev — the coding-practice site. Admin rides LEET_ADMIN_KEY
 * (leet's own key, not the shared ADMIN_KEY) exchanged at /api/auth/key for the
 * same leet_session cookie GitHub login mints. The session attaches to the
 * owner's user row, so the owner must have signed in via GitHub at least once
 * or login 503s. PATCH routes merge server-side — no read-modify-write here.
 */
export function registerLeetTools(server: McpServer, client: ApiClient | null): void {
  const need =
    "LEET_ADMIN_KEY is not set. Add it to this server's environment to manage " +
    "leet.justin06lee.dev.";

  const withClient = <A,>(
    handler: (client: ApiClient, args: A) => Promise<ToolResult>,
  ): ((args: A) => Promise<ToolResult>) =>
    guarded(async (args: A) => (client ? handler(client, args) : fail(need)));

  /* ── articles ── */

  server.registerTool(
    "leet_list_articles",
    {
      title: "List leet articles",
      description:
        "List every article on leet.justin06lee.dev, including unpublished drafts. " +
        "Rows carry id, slug, title, pattern, and published — not the body.",
      inputSchema: {},
    },
    withClient(async (c) => ok(await c.request("/api/admin/articles"))),
  );

  server.registerTool(
    "leet_get_article",
    {
      title: "Read a leet article",
      description: "Read one article in full, body included. Ids come from leet_list_articles.",
      inputSchema: { id: z.string().min(1) },
    },
    withClient(async (c, { id }: { id: string }) =>
      ok(await c.request(`/api/admin/articles/${encodeURIComponent(id)}`)),
    ),
  );

  server.registerTool(
    "leet_create_article",
    {
      title: "Create a leet article",
      description:
        "Create an article (an unpublished draft unless `published` is true). The slug is " +
        "derived from the title when omitted and deduped automatically.",
      inputSchema: {
        title: z.string().min(1),
        body: z.string().optional().describe("Markdown body. Defaults to empty."),
        pattern: z.string().optional().describe("The curriculum pattern this belongs to."),
        slug: z.string().optional(),
        published: z.boolean().optional(),
      },
    },
    withClient(async (c, args: Record<string, unknown>) =>
      ok(await c.request("/api/admin/articles", { method: "POST", body: args })),
    ),
  );

  server.registerTool(
    "leet_update_article",
    {
      title: "Update a leet article",
      description:
        "Change fields on an article. Only the fields you pass are modified — the merge " +
        "happens server-side. Returns the (possibly re-deduped) slug.",
      inputSchema: {
        id: z.string().min(1),
        title: z.string().min(1).optional(),
        body: z.string().optional(),
        pattern: z.string().nullable().optional(),
        slug: z.string().optional(),
        published: z.boolean().optional(),
      },
    },
    withClient(async (c, { id, ...patch }: { id: string } & Record<string, unknown>) =>
      ok(
        await c.request(`/api/admin/articles/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      ),
    ),
  );

  server.registerTool(
    "leet_delete_article",
    {
      title: "Delete a leet article",
      description: "Permanently delete an article. There is no undo — confirm with the user first.",
      inputSchema: { id: z.string().min(1) },
    },
    withClient(async (c, { id }: { id: string }) =>
      ok(
        await c.request(`/api/admin/articles/${encodeURIComponent(id)}`, { method: "DELETE" }),
        `Deleted article ${id}.`,
      ),
    ),
  );

  /* ── problems ── */

  server.registerTool(
    "leet_list_problems",
    {
      title: "List leet problems",
      description:
        "List every practice problem, including unpublished drafts. Rows carry id, slug, " +
        "title, pattern, difficulty, judgingMode, and published.",
      inputSchema: {},
    },
    withClient(async (c) => ok(await c.request("/api/admin/problems"))),
  );

  server.registerTool(
    "leet_get_problem",
    {
      title: "Read a leet problem",
      description:
        "Read one problem in full — statement, starter code, and every test including " +
        "hidden ones. Ids come from leet_list_problems.",
      inputSchema: { id: z.string().min(1) },
    },
    withClient(async (c, { id }: { id: string }) =>
      ok(await c.request(`/api/admin/problems/${encodeURIComponent(id)}`)),
    ),
  );

  server.registerTool(
    "leet_create_problem",
    {
      title: "Create a leet problem",
      description:
        "Create a practice problem (unpublished draft unless `published` is true). " +
        "judgingMode 'function' (the default) requires `functionName`. Add tests " +
        "afterwards with leet_set_problem_tests.",
      inputSchema: {
        title: z.string().min(1),
        statement: z.string().optional().describe("Markdown problem statement."),
        pattern: z.string().optional(),
        difficulty: difficulty.optional().describe("Defaults to medium."),
        judgingMode: judgingMode.optional().describe("Defaults to function."),
        functionName: z.string().optional().describe("Required when judgingMode is 'function'."),
        params: z.array(param).optional().describe("Function parameters, [{name, type}]."),
        returnType: z.string().optional(),
        starterCode: z
          .record(z.string(), z.string())
          .optional()
          .describe("Starter code keyed by language, e.g. {javascript: '...', python: '...'}."),
        slug: z.string().optional(),
        published: z.boolean().optional(),
      },
    },
    withClient(async (c, args: Record<string, unknown>) =>
      ok(await c.request("/api/admin/problems", { method: "POST", body: args })),
    ),
  );

  server.registerTool(
    "leet_update_problem",
    {
      title: "Update a leet problem",
      description:
        "Change fields on a problem. Only the fields you pass are modified — the merge " +
        "happens server-side and is re-validated against the merged row.",
      inputSchema: {
        id: z.string().min(1),
        title: z.string().min(1).optional(),
        statement: z.string().optional(),
        pattern: z.string().nullable().optional(),
        difficulty: difficulty.optional(),
        judgingMode: judgingMode.optional(),
        functionName: z.string().nullable().optional(),
        params: z.array(param).optional(),
        returnType: z.string().nullable().optional(),
        starterCode: z.record(z.string(), z.string()).optional(),
        slug: z.string().optional(),
        published: z.boolean().optional(),
      },
    },
    withClient(async (c, { id, ...patch }: { id: string } & Record<string, unknown>) =>
      ok(
        await c.request(`/api/admin/problems/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: patch,
        }),
      ),
    ),
  );

  server.registerTool(
    "leet_delete_problem",
    {
      title: "Delete a leet problem",
      description:
        "Permanently delete a problem and ALL of its tests. There is no undo — confirm " +
        "with the user first.",
      inputSchema: { id: z.string().min(1) },
    },
    withClient(async (c, { id }: { id: string }) =>
      ok(
        await c.request(`/api/admin/problems/${encodeURIComponent(id)}`, { method: "DELETE" }),
        `Deleted problem ${id} and its tests.`,
      ),
    ),
  );

  server.registerTool(
    "leet_set_problem_tests",
    {
      title: "Replace a leet problem's tests",
      description:
        "FULL REPLACE of a problem's test set — every existing test is deleted and the " +
        "given list becomes the whole set, ordered as passed. Read the current tests with " +
        "leet_get_problem first and resend the ones you want to keep.",
      inputSchema: {
        id: z.string().min(1),
        tests: z.array(test).describe("The complete new test set. kind is visible|hidden."),
      },
    },
    withClient(async (c, { id, tests }: { id: string; tests: unknown[] }) =>
      ok(
        await c.request(`/api/admin/problems/${encodeURIComponent(id)}/tests`, {
          method: "PUT",
          body: { tests },
        }),
        `Replaced the test set (${tests.length} test(s)).`,
      ),
    ),
  );
}
