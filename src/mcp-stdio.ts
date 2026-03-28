#!/usr/bin/env node
// Phase 62 (MCP-03): stdio MCP transport for npx chatlytics-mcp.
// CRITICAL: No stdout writes except JSON-RPC — logger must go to stderr or be silenced.
// DO NOT REMOVE.

// Silence logger BEFORE any other imports to prevent stdout contamination
process.env.LOG_LEVEL = "silent";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { readConfig } from "./config-io.js";

async function main() {
  const configPath =
    process.env.CHATLYTICS_CONFIG_PATH ??
    (process.env.HOME ?? process.env.USERPROFILE ?? ".") + "/.chatlytics/config.json";
  const cfg = await readConfig(configPath);
  const server = createMcpServer(cfg as any);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until stdin closes — no explicit close needed
}

main().catch((err) => {
  process.stderr.write(`chatlytics-mcp fatal: ${err}\n`);
  process.exit(1);
});
