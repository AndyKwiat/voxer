# Voxer

> Agents: start with `CLAUDE.md` / `AGENTS.md`. Docs live in `docs/` and per-directory READMEs.

A minimal 3D voxel editor. TypeScript + Three.js in the browser, Bun for everything else.

```sh
bun install
bun run dev      # builds, then serves http://localhost:3000 (PORT env to change)
bun test         # unit tests
bun run typecheck
bun scripts/browser-check.ts   # headless Chrome smoke test + screenshot
```

Append `?demo` to the URL to start with a few voxels placed.

## Controls
- **Mouse**: left = apply tool (drag to keep applying) · right-drag = orbit · middle-drag or shift-drag = pan · wheel = zoom
- **Trackpad**: two-finger scroll / pinch = zoom · alt/option-drag or alt+scroll = orbit · shift-drag = pan
- **Keys**: `1`/`2`/`3` (or `B`/`E`/`P`) pen/eraser/paint · `Tab` next tool · `[` `]` prev/next color · `⌘Z` undo · `⇧⌘Z` / `⌘Y` redo · `F` reset view · `G` toggle grid · hold `Space` + drag to orbit
- Palette: click to select, double-click to edit (repaints all voxels using it), `+` adds a color.

## Layout
- `src/core/` — pure logic, no DOM: `Editor` (all state + events), `VoxelGrid` (256³ `Uint8Array`), `Palette`, `Raycast` (DDA voxel traversal + floor/wall planes), `Tools`, `History` (undo/redo strokes)
- `src/render/` — Three.js: chunked meshing with face culling, grid lines, orbit camera, viewport
- `src/ui/` — views over the Editor (palette panel, toolbar, status bar, color picker) and `InputController` (mouse/trackpad/keyboard bindings)
- `server/index.ts` — static file server (`Bun.serve`); the place to add save/load endpoints later
- `test/` — `bun test` suites for core, mesher, grid lines and server

`window.voxer` exposes `{ editor, view }` in the browser console for debugging.
