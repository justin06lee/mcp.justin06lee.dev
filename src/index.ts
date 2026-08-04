#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.ts";
import { createServer, VERSION } from "./server.ts";
import { doctor } from "./doctor.ts";

const USAGE = `justin06lee-mcp ${VERSION}

An MCP stdio server. It is normally spawned by an agent (Otto / Claude Code),
not run by hand — there is no daemon and nothing to keep alive.

  justin06lee-mcp            serve MCP over stdio (what the agent runs)
  justin06lee-mcp --doctor   check SITE_URL + ADMIN_KEY against the live site
  justin06lee-mcp --version  print the version

Environment:
  SITE_URL             deployment to control (default https://justin06lee.dev)
  ADMIN_KEY            required; same key the site is deployed with
  REQUEST_TIMEOUT_MS   per-request timeout (default 15000)
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.error(USAGE);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.error(VERSION);
    return;
  }
  if (args.includes("--doctor")) {
    process.exit(await doctor());
  }

  const config = loadConfig();
  const server = createServer(config);

  // stdout is the MCP wire protocol — every diagnostic has to go to stderr or
  // it corrupts the stream and the client drops the connection.
  console.error(`justin06lee-mcp ${VERSION} → ${config.siteUrl}`);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
