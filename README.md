# paraplex-mcp

Connect Claude Code — or any MCP client — to the [Paraplex](https://paraplex.ai)
tab you have open. Paraplex is a 3D motion design studio in the browser, with an
AI assistant that edits real layers and keyframes. With this server, an agent in
your terminal can build and change scenes in your tab with the same tools the
assistant uses, look at frames as it goes, and export.

```bash
claude mcp add paraplex -- npx -y paraplex-mcp
```

Then ask Claude Code for a piece — "a 10-second launch video with three glass
cards and our logo" — and it will tell you how to connect:

1. Open Paraplex at <https://app.paraplex.ai>.
2. **Menu › Connect an agent**, and enter the port and the six-digit code Claude
   Code gives you.

A banner shows in your tab while an agent is connected; disconnect it there any
time.

## What it can do

| Tool | What it does |
| --- | --- |
| `connection` | Whether a tab is attached; if not, the port and code to give you |
| `scene` | The open scene: canvas, duration, time, every layer |
| `list_tools`, `run_tool` | The assistant's verbs (`build_scene`, `add_text`, `set_keyframes`, `add_camera_move`…) and running one |
| `list_templates`, `apply_template`, `new_project` | Start from a template or a blank file |
| `set_time`, `frame`, `frames`, `export_png` | Look at the piece at any time, as its export draws it |
| `scene_facts` | Where every layer lands in the frame, type sizes on the frame, the camera |
| `export_video` | Export the video to a file on this computer (`./paraplex-exports`, or `PARAPLEX_OUT_DIR`) |
| `import_hyperframes` | Bring in a HyperFrames project from a folder or .zip on this computer: one code layer, its sound on the timeline |
| `save_project` | Save the scene as a project in your browser |

Every edit lands in your tab as one undo step, so you can step back through
anything the agent did.

## Privacy and safety

- The server listens on this computer only (port 47821; pass another as
  `npx paraplex-mcp 48000`).
- Only a Paraplex page can connect, and only with the one-time code.
- Nothing is sent anywhere else: the scene stays in your tab, and exports are
  written where you ran the server.
- AI used inside Paraplex is metered by your Paraplex plan as usual; the agent's
  own model is your Claude Code's.

## Browsers

Chrome, Edge or Arc (other browsers may not let a website reach your own
computer). If your browser asks to let app.paraplex.ai connect to devices on
your local network, allow it: that is this server.

## License

MIT © Paraplex Digital, LLC
