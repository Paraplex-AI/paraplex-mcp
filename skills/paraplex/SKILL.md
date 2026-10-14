---
name: paraplex
description: Make or change a motion piece in the person's own open Paraplex tab from Claude Code — attach through the Paraplex MCP server (attach mode), build with the assistant's verbs (build_scene for a whole piece), look at frames as you go, and export. Use when the person asks for a video, a promo, a title sequence, a UI animation or any Paraplex scene to be made or edited from the terminal.
---

# Paraplex from Claude Code

Paraplex is a browser editor for motion design: 3D panels, type, particles,
formations, generators, code layers, a keyframe timeline, and exports. The
Paraplex MCP server in **attach mode** drives the tab the person already has
open — their scene, their undo — rather than an editor of its own.

## Connect

1. The server is registered once (it waits on this computer for the
   person's tab; nothing is installed in the browser):
   `claude mcp add paraplex -- npx -y paraplex-mcp`
   (Working in the Paraplex repo itself, `npm run agent --silent -- attach`
   is the same server.)
2. Call `connection`. Until a tab is attached it gives a port and a
   one-time code: tell the person, word for word, to open Paraplex and go to
   **Menu → Connect an agent**, then enter that port and code. A banner in
   their tab shows while you are connected; they can disconnect any time.
3. Call `scene` to see what is there before changing anything.

Everything you run lands in their tab, each verb one undo step for them. Say
what you changed after each step; never clear their scene without asking.

## Build

- `list_tools` gives every verb with its schema; `run_tool` runs one.
- A whole piece in one call: `run_tool` with `build_scene` — each layer the
  fields of its add verb plus `props`, `keys` (`[seconds, value, easing]`,
  the easing arriving at the key), `clip`, `children` and `then` (any other
  verb, `$id` naming another layer). Read its `warnings`: what could not be
  built is skipped and said.
- Small changes: the verbs themselves (`set_property`, `set_keyframes`,
  `add_camera_move`, `set_text_animation`, `set_layout` …), addressed by the
  layer names the spec gave.
- Procedural geometry: `add_generator` (a starter or your own module);
  many cards or dots in one shape: `add_formation` + `key_formation`; live
  HTML or a React component: `write_code_layer`.
- A HyperFrames project you wrote (or the person has): `import_hyperframes`
  with its folder or .zip. The whole project becomes one code layer —
  nested compositions, media and HyperFrames' runtime driven by the
  playhead — and each `<audio>` clip a sound layer at its start. Then build
  around it: Paraplex layers over or behind it, camera moves, effects.
- A Remotion composition: `write_code_layer` with the one file (component
  and `<Composition>` together). Its `remotion` import is Paraplex's own
  version on the layer's clock — `useCurrentFrame`, `Sequence`, `Series`,
  `interpolate`, `spring`, `@remotion/google-fonts` — and `<Composition>`
  sets the layer's size and length. `<Audio>` is silent: add sound with
  the audio verbs; `staticFile` has no folder: use web addresses.

## Look, then fix

After every section, look: `frames` (one picture per time), `frame` at a
moment, `scene_facts` (where each layer lands on the frame, type sizes, the
camera). Check frame fit (nothing the piece is about half out of frame at a
hold), type (a caption ≥ 14 px on the frame, contrast ≥ 3:1), motion (one
ease per move, holds long enough to read) — fix what you see, then look
again. Work section by section for anything longer than a few seconds: plan
the sections, block a storyboard with `build_scene`, show the person the
frames, and build once they agree.

## Deliver

`export_png` returns a still; `export_video` writes the file (in
`./paraplex-exports`, where the server was started) and says where.
`save_project` saves the scene in their browser by name.
