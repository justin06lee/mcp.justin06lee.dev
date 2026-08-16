/**
 * Boots the built server over stdio and asserts the handshake and tool
 * manifest. Uses a throwaway ADMIN_KEY and never reaches the network — this
 * checks that the server *starts and advertises correctly*, which is exactly
 * what breaks when a schema or an import is wrong.
 *
 *   bun run scripts/smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED = [
  "list_items",
  "create_item",
  "update_item",
  "move_item",
  "delete_item",
  "get_site_config",
  "update_site_config",
  "list_calendar_tasks",
  "create_calendar_task",
  "update_calendar_task",
  "delete_calendar_task",
  "list_calendar_categories",
  "create_calendar_category",
  "update_calendar_category",
  "delete_calendar_category",
  "get_running_timers",
  "start_timer",
  "stop_timer",
  "list_time_entries",
  "create_time_entry",
  "update_time_entry",
  "delete_time_entry",
  "get_prayer_times",
  "reverse_geocode",
  "get_pats",
  "list_uploads",
  "upload_image",
  "delete_upload",
  "revalidate_articles",
  "upload_article_image",
  "truman_stream_status",
  "truman_set_live",
  "truman_read_chat",
  "truman_post_chat",
  "truman_clear_chat",
  "truman_revoke_sessions",
  "truman_delete_episode",
  "listen_room_status",
  "listen_set_room",
];

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { PATH: process.env.PATH ?? "", ADMIN_KEY: "smoke-test-key", SITE_URL: "http://localhost:9" },
  stderr: "pipe",
});

const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();

const missing = EXPECTED.filter((n) => !names.includes(n));
const extra = names.filter((n) => !EXPECTED.includes(n));

let failed = false;

if (missing.length) {
  console.error(`✗ missing tools: ${missing.join(", ")}`);
  failed = true;
}
if (extra.length) {
  console.error(`✗ unexpected tools: ${extra.join(", ")}`);
  failed = true;
}

// Every tool needs a description and a schema, or the model is guessing.
for (const tool of tools) {
  if (!tool.description) {
    console.error(`✗ ${tool.name} has no description`);
    failed = true;
  }
  if (!tool.inputSchema || tool.inputSchema.type !== "object") {
    console.error(`✗ ${tool.name} has no object input schema`);
    failed = true;
  }
}

// A call against an unreachable SITE_URL must come back as a clean tool error,
// not an unhandled rejection that kills the process.
const result = await client.callTool({ name: "list_items", arguments: {} });
if (!result.isError) {
  console.error("✗ expected an error result when SITE_URL is unreachable");
  failed = true;
}

await client.close();

console.log(failed ? "\nSMOKE FAILED" : `✓ ${tools.length} tools, schemas valid, errors handled`);
process.exit(failed ? 1 : 0);
