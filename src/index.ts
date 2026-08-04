#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);

  // stdout is the MCP wire protocol — every diagnostic has to go to stderr or
  // it corrupts the stream and the client drops the connection.
  console.error(`justin06lee-mcp → ${config.siteUrl}`);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
