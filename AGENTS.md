# AGENTS.md — how to work on Voxer

Voxer is a browser 3D voxel editor: TypeScript + Three.js front end, Bun for package
management, tests, bundling and a small static server. It is built primarily by AI agents;
keep the docs in this tree accurate as you change things.

## Commands
```sh
bun install            # deps (Bun ≥ 1.2; tested on 1.4.3 — `bun upgrade` if older)
bun run dev            # build + serve http://localhost:3005 (PORT env overrides); press o to open, q to quit
bun test               # unit tests (bun:test)
bun run typecheck      # tsc --noEmit — must be clean
bun run build          # bundles src/main.ts -> public/main.js (gitignored)
bun run recipe <files|dirs> [--out out/recipes] [--figure] [--export glb] [--strict] [--no-sheet]   # build recipe files (recipes/README.md)
bun scripts/browser-check.ts   # headless Chrome smoke test of the real app (see docs/TESTING.md)
VOXER_SCRATCH=1 bun mcp/server.ts   # MCP in scratch mode: private in-memory server, never touches models/ or your tab
bun mcp/server.ts      # MCP server (stdio) — .mcp.json runs it as "voxer" via mcp/run.sh (finds bun for GUI apps); see src/agent/README.md
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
Batch drawing (`core/Commands.ts`: box/ellipsoid/layer/mirror…, plus the architecture parts in
`core/Parts.ts`: roof/walls/window/door/…/stamp) goes through `Editor.run(ops)` / `runReport(ops)` as one undo
step; every write passes `Draft.set`, which feeds the write report (`core/Report.ts`: clipped/erased/overwritten
cells). Scenes may carry material `slots` (shade ramps → variants) and `anchors` (named cells) — format v2.
`core/Lint.ts` checks models, `core/GreedyMesher` + `MeshExport` export meshes. `src/agent/` exposes that plus snapshots and the reference image to agents (`/voxelize` skill).
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
8. **Never write to the user's `models/` from scripts or tests.** Use scratch mode (`VOXER_SCRATCH=1`,
   `startServer(…, {scratch: true})`, `scripts/lib/headless.ts`) and temp dirs; `save_scene {path}` for files.
9. New drawing ops must write through `Draft.set` (so write reports count them) and live in their own module
   with a one-line dispatch in `Commands.applyOp` (see `Parts.ts`).

## Where things are
```
src/main.ts          wiring only
src/core/            Editor, VoxelGrid, Palette, Raycast, Tools, History, Emitter, Commands, Parts (architecture ops),
                     Report (write reports), Lint, Slots, Anchors, Scene, GreedyMesher, MeshExport
src/render/          Viewport, ChunkMesher, GridLines, OrbitCamera, Views, Capture, ScaleFigure, AnchorOverlay
src/ui/              InputController, PalettePanel, Toolbar, StatusBar, ColorPicker, ScenePanel, ExportButton
src/agent/           Api (window.voxer.api), Bridge (WebSocket to hub), Reference (image + sampling), Export
server/              index.ts (static + /api; scratch mode), Hub.ts (agent WebSocket routing), Store.ts (models/),
                     SceneFile.ts (scenes at absolute paths)
mcp/                 MCP stdio server + tool schemas, snapshot.ts (retry plan)
models/              saved scenes (<name>.json); _autosave.json / _reference.* are gitignored
public/index.html    the single page + all CSS
test/                one file per module
scripts/             dev tooling (browser-check, lib/chrome.ts headless Chrome, lib/headless.ts in-memory Voxer for scripts)
recipes/             recipe files (models as code) + examples; built by scripts/build.ts / MCP build_recipe
                     (shared builder: scripts/lib/recipe-build.ts)
examples/            example op lists (house.json = a full building from parts ops)
docs/                ARCHITECTURE, CONTROLS, TESTING, ROADMAP
.claude/skills/      agent skills
```
