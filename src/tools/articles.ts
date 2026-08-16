import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import { fail, guarded, ok, type ToolResult } from "./shared.ts";
import { loadImage } from "./uploads.ts";

/** The desk upload path allows larger files than the general uploads table. */
const MAX_DESK_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * The article CMS itself (create/save/delete/visibility) lives behind Next.js
 * server actions with no HTTP routes, so it cannot be wrapped here — these two
 * endpoints are the only article surfaces reachable over HTTP.
 */
export function registerArticleTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "revalidate_articles",
    {
      title: "Revalidate the articles cache",
      description:
        "Bust the site's cached article pages after content changed out-of-band (e.g. a " +
        "direct push to the articles GitHub repo). Always refreshes the index; pass `slug` " +
        "to also refresh one article page.",
      inputSchema: {
        slug: z
          .string()
          .regex(/^[\w-]+$/, "slug may only contain letters, digits, _ and -")
          .optional(),
      },
    },
    guarded(async ({ slug }) =>
      ok(await client.request("/api/articles/revalidate", { method: "POST", query: { slug } })),
    ),
  );

  server.registerTool(
    "upload_article_image",
    {
      title: "Upload an image into an article",
      description:
        "Commit an image (PNG/JPEG/GIF/WebP, max 10 MB) into the articles GitHub repo next " +
        "to an existing article. `article_path` is the slash-delimited article location, " +
        "e.g. 'systems/memory-allocators'.",
      inputSchema: {
        article_path: z.string().min(1),
        path: z.string().min(1).optional().describe("Local file path on this machine."),
        base64: z.string().min(1).optional().describe("Inline base64 image data instead of a path."),
        filename: z.string().min(1).optional().describe("Required with `base64`; defaults to the path's basename."),
      },
    },
    guarded(async (args): Promise<ToolResult> => {
      const loaded = await loadImage(args, MAX_DESK_UPLOAD_BYTES);
      if ("error" in loaded) return fail(loaded.error);

      const form = new FormData();
      form.append("file", loaded.file);
      form.append("articlePath", args.article_path);

      const result = await client.request("/api/desk/upload", { method: "POST", form });
      return ok(result, `Uploaded "${loaded.file.name}" into ${args.article_path}.`);
    }),
  );
}
