#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpHandler, serveMcpOverStdio } from "./lib/mcp.mjs";
import { attachedTabTools, attachParaplexTab, PARAPLEX_ATTACH_PORT } from "./lib/paraplex-tab.mjs";

/**
 * paraplex-mcp: the Paraplex MCP server in attach mode, for anyone.
 *
 *   claude mcp add paraplex -- npx -y paraplex-mcp
 *
 * It opens no editor of its own: it waits on this computer for the Paraplex
 * tab you have open to connect (in Paraplex: Menu → Connect an agent, with
 * the port and the one-time code it gives), then sends its calls there —
 * every edit lands in your tab as one undo step. Only a Paraplex page may
 * connect, only with the code. Nothing is sent anywhere else.
 *
 *   npx paraplex-mcp [port]          # another port than 47821
 *   PARAPLEX_OUT_DIR=…               # where export_video writes (./paraplex-exports)
 */

const here = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
// stdout is the MCP channel: everything said to the person goes to stderr.
const log = (text) => process.stderr.write(`[paraplex] ${text}\n`);
const portArg = process.argv.slice(2).find((arg) => /^\d+$/.test(arg)) ?? process.env.PARAPLEX_PORT;
const port = portArg !== undefined ? Number(portArg) : PARAPLEX_ATTACH_PORT;
const outDir = process.env.PARAPLEX_OUT_DIR ?? join(process.cwd(), "paraplex-exports");

let tab;

try {
  tab = await attachParaplexTab({ log, port });
} catch (error) {
  log(`Could not listen on port ${port}: ${error?.message ?? error}. Pass another: npx paraplex-mcp <port>`);
  process.exit(1);
}

const settled = serveMcpOverStdio(createMcpHandler({ name: "paraplex", tools: attachedTabTools(tab, { outDir }), version }));

process.stdin.on("end", async () => {
  await settled();
  await tab.close();
  process.exit(0);
});
