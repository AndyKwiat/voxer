# AGENTS.md — how to work on Voxer

Voxer is a browser 3D voxel editor: TypeScript + Three.js front end, Bun for package
management, tests, bundling and a small static server. It is built primarily by AI agents;
keep the docs in this tree accurate as you change things.

## Commands
```sh
bun install            # deps
bun run dev            # build + serve http://localhost:3005 (PORT env overrides); press o to open, q to quit
bun test               # unit tests (bun:test)
bun run typecheck      # tsc --noEmit — must be clean
bun run build          # bundles src/main.ts -> public/main.js (gitignored)
bun scripts/browser-check.ts   # headless Chrome smoke test of the real app (see docs/TESTING.md)
bun mcp/server.ts      # MCP server (stdio) — registered in .mcp.json as "voxer"; see src/agent/README.md
```

## Fixed decisions (do not relitigate)
- Three.js is the only runtime dependency. No UI framework; plain DOM.
- Voxel space is 32³ by default (max 256³), **Y is up, Z is forward**, cells are unit cubes at integer coords.
- Grid cell value: `0` = empty, `n` = palette index `n-1` (`Palette.toCell/fromCell`).
- Fixed, growable palette (starts with 32, max 255). Editing a color recolors all voxels using it.
- Tools: pen, eraser, paint. Undo/redo groups edits per mouse stroke. A held pen drag is locked to one plane —
  orientation from the camera direction at press, offset from the first voxel placed; see `docs/CONTROLS.md`.
- Black background, grid lines on floor + back wall (z=0) + left wall (x=0), every cell, brighter every 16.
- Orbit camera. Controls in `docs/CONTROLS.md`.
- Server is TypeScript (`Bun.serve`): static files + `/api/*` (agent RPC relay, reference image, scenes) + `/agent` WebSocket hub.
- Agents drive the app through MCP (`mcp/server.ts`) → server hub → the active page's `window.voxer.api`.
  The **page** owns the scene and renders snapshots; headless Chrome stands in when no tab is open.

## Architecture in one paragraph
`src/core/` is pure, DOM-free logic and holds all state in `Editor` (grid, palette, history,
current tool + color). `Editor` emits typed events (`voxels`, `tool`, `color`, `palette`).
`src/render/Viewport` and `src/ui/*` subscribe to those events; they never own state.
`src/ui/InputController` turns mouse/trackpad/keyboard into `Editor`/camera calls. Picking is
an exact DDA raycast through the grid (`core/Raycast.ts`), not Three.js mesh intersection.
Batch drawing (`core/Commands.ts`: box/ellipsoid/layer/mirror…) goes through `Editor.run(ops)` as one undo
step. `src/agent/` exposes that plus snapshots and the reference image to agents (`/voxelize` skill).
Details: `docs/ARCHITECTURE.md`.

## Rules
1. **State lives in `Editor`.** UI classes render from events; never store selection/tool in DOM classes.
2. **Core stays pure.** Nothing in `src/core/` may import Three.js or touch `document`/`window`.
3. **Every core change gets a `bun test`.** Render/UI logic that can be pure (meshing, grid lines) is tested too.
4. Before claiming a UI/render change works, run `/browser-check` (or `bun scripts/browser-check.ts`) — SwiftShader
   has quirks (e.g. drops long lines crossing the near plane; that's why grid lines are split into 16-unit pieces).
5. Keep `bun run typecheck` clean; `strict` + `noUncheckedIndexedAccess` are on.
6. Update the README in the directory you changed and `docs/ROADMAP.md` when you finish or add an item.
7. Don't add dependencies without a reason written in `docs/ARCHITECTURE.md`.

## Where things are
```
src/main.ts          wiring only
src/core/            Editor, VoxelGrid, Palette, Raycast, Tools, History, Emitter, Commands, Scene
src/render/          Viewport, ChunkMesher, GridLines, OrbitCamera, Views, Capture
src/ui/              InputController, PalettePanel, Toolbar, StatusBar, ColorPicker
src/agent/           Api (window.voxer.api), Bridge (WebSocket to hub), Reference (image + sampling)
server/              index.ts (static + /api), Hub.ts (agent WebSocket routing), Store.ts (models/)
mcp/                 MCP stdio server + tool schemas
models/              saved scenes (<name>.json); _autosave.json / _reference.* are gitignored
public/index.html    the single page + all CSS
test/                one file per module
scripts/             dev tooling (browser-check, lib/chrome.ts headless Chrome launcher)
docs/                ARCHITECTURE, CONTROLS, TESTING, ROADMAP
.claude/skills/      agent skills
```
