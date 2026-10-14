/**
 * The Model Context Protocol, the part a tool server needs (roadmap v10
 * wave 1): JSON-RPC 2.0 over newline-delimited stdio — `initialize`,
 * `tools/list`, `tools/call`, `ping`. Pure: the handler takes the tools
 * and returns responses, so a test can drive it without a browser.
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export function createMcpHandler({ name, tools, version }) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return async function handle(message) {
    const { id, method, params } = message;
    const reply = (result) => ({ id, jsonrpc: "2.0", result });
    const fail = (code, text) => ({ error: { code, message: text }, id, jsonrpc: "2.0" });

    if (method === "initialize") {
      return reply({ capabilities: { tools: {} }, protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name, version } });
    }

    if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
      return null;
    }

    if (method === "ping") {
      return reply({});
    }

    if (method === "tools/list") {
      return reply({ tools: tools.map(({ description, inputSchema, name: toolName }) => ({ description, inputSchema: inputSchema ?? { properties: {}, type: "object" }, name: toolName })) });
    }

    if (method === "tools/call") {
      const tool = byName.get(params?.name);

      if (!tool) {
        return fail(-32602, `Unknown tool: ${params?.name}`);
      }

      try {
        const content = await tool.run(params.arguments ?? {});

        // A tool answers with content blocks (each with a `type`) or with
        // any value, which is shown as text — an array of templates is data,
        // not a block list.
        const isBlocks = Array.isArray(content) && content.length > 0 && content.every((block) => block && typeof block === "object" && typeof block.type === "string");

        return reply({ content: isBlocks ? content : [{ text: typeof content === "string" ? content : JSON.stringify(content, null, 2), type: "text" }] });
      } catch (error) {
        return reply({ content: [{ text: `Error: ${error?.message ?? String(error)}`, type: "text" }], isError: true });
      }
    }

    if (id === undefined) {
      return null;
    }

    return fail(-32601, `Method not found: ${method}`);
  };
}

/** Runs a handler over stdin/stdout, one JSON message per line. */
export function serveMcpOverStdio(handle, { input = process.stdin, output = process.stdout } = {}) {
  let buffer = "";
  const inFlight = new Set();

  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buffer += chunk;

    let newline = buffer.indexOf("\n");

    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();

      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (!line) {
        continue;
      }

      let message;

      try {
        message = JSON.parse(line);
      } catch {
        output.write(`${JSON.stringify({ error: { code: -32700, message: "Parse error" }, id: null, jsonrpc: "2.0" })}\n`);
        continue;
      }

      const pending = handle(message).then((response) => {
        if (response) {
          output.write(`${JSON.stringify(response)}\n`);
        }
      });

      inFlight.add(pending);
      void pending.finally(() => inFlight.delete(pending));
    }
  });

  /** Resolves once every call received so far has answered — for a clean exit when stdin closes. */
  return () => Promise.allSettled([...inFlight]);
}

/** Image content for a tool result, from a PNG buffer or data URL. */
export function imageContent(pngOrDataUrl, text) {
  const data = Buffer.isBuffer(pngOrDataUrl) ? pngOrDataUrl.toString("base64") : String(pngOrDataUrl).replace(/^data:[^,]+,/, "");
  const mimeType = Buffer.isBuffer(pngOrDataUrl) ? "image/png" : (/^data:([^;]+)/.exec(String(pngOrDataUrl))?.[1] ?? "image/png");
  const content = [{ data, mimeType, type: "image" }];

  return text ? [{ text, type: "text" }, ...content] : content;
}
