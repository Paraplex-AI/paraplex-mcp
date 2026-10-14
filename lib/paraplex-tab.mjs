import { randomInt } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { imageContent } from "./mcp.mjs";
import { serveWebSocket } from "./ws-server.mjs";

/**
 * The agent bridge attached to the person's own tab (roadmap v11, wave 5):
 * where `npm run agent` opens a headless editor of its own, `npm run agent
 * -- attach` waits for the Paraplex tab the person has open to connect —
 * Menu → Connect an agent, with the port and the one-time code printed
 * here — and sends its calls there. Only a page from Paraplex's origins
 * may connect, only with the code, and only the named calls the tab's
 * connector answers exist (agent-connector.ts); no code is sent into the
 * tab.
 */

export const PARAPLEX_ATTACH_PORT = 47821;

/** What a project folder may send the tab: past this, its media will not fit a layer anyway. */
const PROJECT_MAX_BYTES = 96 * 1024 * 1024;
const PROJECT_MAX_FILES = 4000;
const PROJECT_SKIPPED = new Set([".git", ".DS_Store", "__MACOSX", "node_modules"]);

/**
 * A HyperFrames project for the tab (roadmap v20 WB.2): a folder's files as
 * path → base64 (system and dependency folders left out), or a zip's bytes
 * as base64 — the tab makes it one code layer.
 */
export function readParaplexProject(path) {
  const root = resolve(path);
  const stat = statSync(root);

  if (stat.isFile()) {
    if (!/\.zip$/i.test(root)) {
      throw new Error(`${path} is a file: give the project's folder, or a .zip of it.`);
    }

    if (stat.size > PROJECT_MAX_BYTES) {
      throw new Error(`${path} is ${Math.round(stat.size / 1024 / 1024)} MB, more than a project can bring.`);
    }

    return { name: basename(root).replace(/\.zip$/i, ""), zip: readFileSync(root).toString("base64") };
  }

  const files = {};
  let bytes = 0;
  let count = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (PROJECT_SKIPPED.has(entry.name)) {
        continue;
      }

      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        count += 1;
        bytes += statSync(full).size;

        if (count > PROJECT_MAX_FILES || bytes > PROJECT_MAX_BYTES) {
          throw new Error(`${path} holds more than a project can bring (${PROJECT_MAX_FILES} files, ${PROJECT_MAX_BYTES / 1024 / 1024} MB). Leave renders and other large files out.`);
        }

        files[relative(root, full).split("\\").join("/")] = readFileSync(full).toString("base64");
      }
    }
  };

  walk(root);

  return { files, name: basename(root) };
}

/** Paraplex's own origins, and a local dev server's; PARAPLEX_ORIGIN adds one. */
export function paraplexOriginAllowed(origin) {
  const extra = process.env.PARAPLEX_ORIGIN;

  return (
    (typeof extra === "string" && extra.length > 0 && origin === extra) ||
    /^https:\/\/(www\.|app\.)?paraplex\.ai$/.test(origin) ||
    /^https:\/\/([a-z0-9-]+--)?paraplex[a-z0-9-]*\.netlify\.app$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
}

/**
 * Starts the local endpoint and returns `call(method, params)`: sent to the
 * attached tab, answered by it; waits (up to a few minutes) for a tab when
 * none is attached yet.
 */
export async function attachParaplexTab({ allowOrigin = paraplexOriginAllowed, code = String(randomInt(100000, 1000000)), log = () => {}, port = PARAPLEX_ATTACH_PORT } = {}) {
  let tab = null;
  let next = 1;
  const pending = new Map();
  let waiters = [];

  const server = await serveWebSocket({
    allowOrigin,
    onConnection: (peer) => {
      peer.onMessage = (text) => {
        let data;

        try {
          data = JSON.parse(text);
        } catch {
          return;
        }

        if (data.type === "hello") {
          if (String(data.code ?? "") !== code) {
            peer.send(JSON.stringify({ reason: "That code does not match the one the agent printed.", type: "refused" }));
            peer.close();
            return;
          }

          // A second tab takes over from the first.
          if (tab && tab !== peer) {
            tab.close();
          }

          tab = peer;
          peer.send(JSON.stringify({ type: "welcome" }));
          log("A Paraplex tab is attached.");

          for (const wake of waiters) {
            wake();
          }

          waiters = [];
        } else if (data.type === "result" && pending.has(data.id)) {
          const { reject, resolve } = pending.get(data.id);

          pending.delete(data.id);

          if (data.ok) {
            resolve(data.value);
          } else {
            reject(new Error(data.error ?? "The tab could not do that."));
          }
        }
      };
      peer.onClose = () => {
        if (tab === peer) {
          tab = null;

          for (const { reject } of pending.values()) {
            reject(new Error("The tab disconnected."));
          }

          pending.clear();
          log("The tab disconnected.");
        }
      };
    },
    port,
  });
  const address = server.address();
  const listening = typeof address === "object" && address ? address.port : port;

  log(`Waiting for a Paraplex tab: in Paraplex, Menu → Connect an agent, port ${listening}, code ${code}.`);

  const call = async (method, params = {}) => {
    if (!tab) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No Paraplex tab is attached. In Paraplex: Menu → Connect an agent, port ${listening}, code ${code}.`)), 180_000);

        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    const id = next++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) {
          reject(new Error("The tab did not answer in time."));
        }
      }, 600_000);

      pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
      tab.send(JSON.stringify({ id, method, params, type: "call" }));
    });
  };

  return {
    attached: () => tab !== null,
    call,
    close: () => new Promise((resolve) => {
      tab?.close();
      server.close(() => resolve());
    }),
    code,
    port: listening,
  };
}

/** The MCP tools over an attached tab: the headless server's, as far as named calls reach. */
export function attachedTabTools(tab, { outDir }) {
  return [
    {
      // The person cannot see this server's log from Claude Code: the agent
      // asks for the port and code here and tells them.
      description:
        "Whether a Paraplex tab is attached, and if not, what to tell the person: in Paraplex, Menu → Connect an agent, then this port and code. Call it first; say the code to the person exactly.",
      name: "connection",
      run: () =>
        tab.attached()
          ? { attached: true, port: tab.port }
          : {
              attached: false,
              code: tab.code,
              port: tab.port,
              tell: `Open Paraplex in your browser, then Menu → Connect an agent, and enter port ${tab.port} and code ${tab.code}.`,
            },
    },
    {
      description: "The built-in templates: id, label and categories (the first is its section on the home page, e.g. app-promo, brand-promo, starter, website-hero-visuals, titles-text, infographics).",
      name: "list_templates",
      run: () => tab.call("templates"),
    },
    {
      description: "A blank 1920×1080 project in the attached tab (the scene being left is saved as the editor saves it).",
      name: "new_project",
      run: async () => {
        await tab.call("newProject");

        return "A new project.";
      },
    },
    {
      description: "Apply a built-in template by id, as the gallery does.",
      inputSchema: { properties: { id: { type: "string" } }, required: ["id"], type: "object" },
      name: "apply_template",
      run: async ({ id }) => {
        await tab.call("applyTemplate", { id });

        return tab.call("scene");
      },
    },
    {
      description: "The open scene: canvas, duration, current time, and every layer with its kind, name, clip and parent.",
      name: "scene",
      run: () => tab.call("scene"),
    },
    {
      description: "Move the playhead to a time in seconds.",
      inputSchema: { properties: { seconds: { type: "number" } }, required: ["seconds"], type: "object" },
      name: "set_time",
      run: async ({ seconds }) => `At ${await tab.call("setTime", { seconds })}s.`,
    },
    {
      description: "A picture of the frame at a time (or the current one), through the export path — the way to look at what you made.",
      inputSchema: { properties: { seconds: { type: "number" } }, type: "object" },
      name: "frame",
      run: async ({ seconds }) => {
        const dataUrl = await tab.call("exportPng", seconds === undefined ? {} : { seconds });

        return dataUrl ? imageContent(dataUrl, seconds === undefined ? "The frame now." : `The frame at ${seconds}s.`) : "No editor.";
      },
    },
    {
      description: "The frame at several times (default: four across the piece), one picture each.",
      inputSchema: { properties: { times: { items: { type: "number" }, type: "array" } }, type: "object" },
      name: "frames",
      run: async ({ times }) => {
        const scene = await tab.call("scene");
        const moments = times?.length ? times : Array.from({ length: 4 }, (_, index) => Number((((scene?.durationSeconds ?? 8) * (index + 0.5)) / 4).toFixed(2)));
        const content = [];

        for (const seconds of moments) {
          const dataUrl = await tab.call("exportPng", { seconds });

          if (dataUrl) {
            content.push(...imageContent(dataUrl, `${seconds}s`));
          }
        }

        return content.length > 0 ? content : "No editor.";
      },
    },
    {
      description: "The assistant's tools — every verb that edits the scene — with their input schemas. Run one with run_tool.",
      name: "list_tools",
      run: () => tab.call("tools"),
    },
    {
      description: "Run one of the assistant's tools in the attached tab (see list_tools), e.g. build_scene, add_text, set_property, add_camera_move — each call one undo step there.",
      inputSchema: { properties: { input: { type: "object" }, name: { type: "string" } }, required: ["name"], type: "object" },
      name: "run_tool",
      run: ({ input, name }) => tab.call("runTool", { input: input ?? {}, name }),
    },
    {
      description: "The scene at the current time through the export path (what a PNG export produces), as an image.",
      name: "export_png",
      run: async () => {
        const dataUrl = await tab.call("exportPng");

        return dataUrl ? imageContent(dataUrl, "The export.") : "No editor.";
      },
    },
    {
      description: "Export the scene as a video, written to a file in the export folder (or at `path`); answers with where it went.",
      inputSchema: { properties: { path: { type: "string" } }, type: "object" },
      name: "export_video",
      run: async ({ path }) => {
        const result = await tab.call("exportVideo");

        if (!result) {
          return "No editor.";
        }

        const target = path ?? join(outDir, result.fileName);

        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, Buffer.from(String(result.dataUrl).replace(/^data:[^,]+,/, ""), "base64"));

        return `Written: ${target}`;
      },
    },
    {
      description:
        "Import a HyperFrames project (HeyGen's HTML-to-video format) into the attached tab: `path` is its folder (index.html at the top) or a .zip of it. The whole project becomes one code layer — nested data-composition-src files, pictures, videos, fonts and stylesheets embedded, HyperFrames' runtime driven by the playhead — and each <audio> clip a sound layer at its start. Then look at it with frames, and finish it by hand or with run_tool.",
      inputSchema: { properties: { name: { type: "string" }, path: { type: "string" } }, required: ["path"], type: "object" },
      name: "import_hyperframes",
      run: async ({ name, path }) => {
        const project = readParaplexProject(path);
        const result = await tab.call("importHyperFrames", { ...project, ...(name ? { name } : {}) });

        if (!result?.ok) {
          throw new Error(result?.message ?? "The tab did not import it.");
        }

        return { message: result.message, missing: result.missing ?? [], scene: await tab.call("scene") };
      },
    },
    {
      description: "Save the open scene as a project of that browser's, by name.",
      inputSchema: { properties: { name: { type: "string" } }, required: ["name"], type: "object" },
      name: "save_project",
      run: async ({ name }) => `Saved as project ${await tab.call("saveProject", { name })}.`,
    },
    {
      description: "The review's facts at a time: where every layer lands on the frame (NDC boxes, ±1 is the frame's edge), each text's size on the frame in px and its fill, the camera.",
      inputSchema: { properties: { seconds: { type: "number" } }, required: ["seconds"], type: "object" },
      name: "scene_facts",
      run: ({ seconds }) => tab.call("sceneFacts", { seconds }),
    },
  ];
}
