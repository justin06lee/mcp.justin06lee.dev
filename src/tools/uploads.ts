import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "../client.ts";
import { fail, guarded, ok, type ToolResult } from "./shared.ts";

/** Mirrors the site's caps so an oversized file fails here with a clear message. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Loads the image bytes from either a local file path or inline base64.
 * The site sniffs the real format from magic bytes (PNG/JPEG/GIF/WebP only),
 * so no client-side MIME declaration is needed — just the bytes and a name.
 */
export async function loadImage(
  args: { path?: string; base64?: string; filename?: string },
  maxBytes: number,
): Promise<{ file: File } | { error: string }> {
  const { path, base64, filename } = args;
  if ((path === undefined) === (base64 === undefined)) {
    return { error: "Pass exactly one of `path` (a local file) or `base64` (inline data)." };
  }

  let bytes: Uint8Array;
  let name: string;
  if (path !== undefined) {
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (error) {
      return { error: `Could not read ${path}: ${error instanceof Error ? error.message : error}` };
    }
    name = filename ?? basename(path);
  } else {
    try {
      bytes = Uint8Array.from(Buffer.from(base64 as string, "base64"));
    } catch {
      return { error: "`base64` is not valid base64 data." };
    }
    if (!filename) return { error: "`filename` is required when passing `base64`." };
    name = filename;
  }

  if (bytes.length === 0) return { error: "The image is empty." };
  if (bytes.length > maxBytes) {
    return {
      error: `Image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the site caps this upload at ${maxBytes / 1024 / 1024} MB.`,
    };
  }
  return { file: new File([bytes], name) };
}

type UploadRow = { id: string; filename: string; mime_type: string; created_at: string };

export function registerUploadTools(server: McpServer, client: ApiClient): void {
  server.registerTool(
    "list_uploads",
    {
      title: "List uploaded images",
      description:
        "List images stored in the site's uploads table (newest first). Rows carry id, " +
        "filename, and mime type; the binary itself is served publicly at /api/uploads/<id>.",
      inputSchema: {
        article_slug: z.string().min(1).optional().describe("Filter to one article's images."),
        limit: z.number().int().min(1).max(100).optional().describe("Default 50, max 100."),
        offset: z.number().int().min(0).optional(),
      },
    },
    guarded(async ({ article_slug, limit, offset }) =>
      ok(await client.request<UploadRow[]>("/api/uploads", { query: { article_slug, limit, offset } })),
    ),
  );

  server.registerTool(
    "upload_image",
    {
      title: "Upload an image",
      description:
        "Store an image (PNG/JPEG/GIF/WebP, max 5 MB) in the site's uploads table and get " +
        "back its public URL. The format is sniffed from the bytes, not the filename.",
      inputSchema: {
        path: z.string().min(1).optional().describe("Local file path on this machine."),
        base64: z.string().min(1).optional().describe("Inline base64 image data instead of a path."),
        filename: z.string().min(1).optional().describe("Required with `base64`; defaults to the path's basename."),
        article_slug: z.string().min(1).optional().describe("Associate the image with an article."),
      },
    },
    guarded(async (args): Promise<ToolResult> => {
      const loaded = await loadImage(args, MAX_UPLOAD_BYTES);
      if ("error" in loaded) return fail(loaded.error);

      const form = new FormData();
      form.append("file", loaded.file);
      if (args.article_slug) form.append("article_slug", args.article_slug);

      const result = await client.request<{ id: string; url: string }>("/api/uploads", {
        method: "POST",
        form,
      });
      return ok(result, `Uploaded "${loaded.file.name}".`);
    }),
  );

  server.registerTool(
    "delete_upload",
    {
      title: "Delete an uploaded image",
      description:
        "Permanently remove an uploaded image. Anything embedding its /api/uploads/<id> URL " +
        "will break — check list_uploads first.",
      inputSchema: { id: z.string().min(1) },
    },
    guarded(async ({ id }) => {
      // The site's DELETE is blind (200 even for a missing id), so verify the
      // row exists first via the public binary route to keep results truthful.
      try {
        await client.request(`/api/uploads/${encodeURIComponent(id)}`);
      } catch {
        return fail(`No upload with id "${id}" — nothing deleted. Use list_uploads for valid ids.`);
      }
      await client.request(`/api/uploads/${encodeURIComponent(id)}`, { method: "DELETE" });
      return ok({ id }, "Deleted upload.");
    }),
  );
}
