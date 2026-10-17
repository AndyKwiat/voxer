# Voxer

> Agents: start with `CLAUDE.md` / `AGENTS.md`. Docs live in `docs/` and per-directory READMEs.

A minimal 3D voxel editor. TypeScript + Three.js in the browser, Bun for everything else.

```sh
bun install
bun run dev      # builds, then serves http://localhost:3005 (PORT env to change); o opens it, q quits
bun test         # unit tests
bun run typecheck
bun scripts/browser-check.ts   # headless Chrome smoke test + screenshot
```

Append `?demo` to the URL to start with a few voxels placed. The scene autosaves (`models/_autosave.json`)
and comes back when you reload.

## Agent control (MCP)
`.mcp.json` registers the `voxer` MCP server (`bun mcp/server.ts`) for Claude Code in this folder. Give
Claude a reference image (paste it in the chat, paste/drop it into the app, or a file path) plus a
description and ask it to build the model (`/voxelize`). It works headless; ask it to `open_viewer` (or
open http://localhost:3005) to watch live. Tools: `draw` (batched box/ellipsoid/cylinder/line/ASCII
`layer`/mirror/translate…), `run_script`, `snapshot` (labeled multi-view sheet), `sample_reference`,
`save_scene`/`load_scene`, and more — see `src/agent/README.md`. In the browser console the same API is
`window.voxer.api`.

## Controls
- **Mouse**: left = apply tool (drag to keep applying) · right-drag = orbit · middle-drag or shift-drag = pan · wheel = zoom
- **Trackpad**: two-finger scroll / pinch = zoom · alt/option-drag or alt+scroll = orbit · shift-drag = pan
- **Keys**: `1`/`2`/`3` (or `B`/`E`/`P`) pen/eraser/paint · `Tab` next tool · `[` `]` prev/next color · `⌘Z` undo · `⇧⌘Z` / `⌘Y` redo · `F` reset view · `G` toggle grid · hold `Space` + drag to orbit
- **Scenes**: New / Save / Load buttons at the top of the sidebar (files in `models/`).
- Palette: click to select, double-click to edit (repaints all voxels using it), `+` adds a color.

## Layout
- `src/core/` — pure logic, no DOM: `Editor` (all state + events), `VoxelGrid` (32³ `Uint8Array` by default, up to 256³), `Palette`, `Raycast` (DDA voxel traversal + floor/wall planes), `Tools`, `History` (undo/redo strokes)
- `src/render/` — Three.js: chunked meshing with face culling, grid lines, orbit camera, viewport
- `src/ui/` — views over the Editor (palette panel, toolbar, status bar, color picker) and `InputController` (mouse/trackpad/keyboard bindings)
- `src/agent/` — agent API (`window.voxer.api`), WebSocket bridge, reference image
- `server/` — `Bun.serve`: static files, `/api/*`, agent WebSocket hub, `models/` storage
- `mcp/` — MCP stdio server
- `test/` — `bun test` suites for core, mesher, grid lines and server

`window.voxer` exposes `{ editor, view, api }` in the browser console.
