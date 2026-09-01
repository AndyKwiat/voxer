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

Append `?demo` to the URL to start with a few voxels placed.

## Controls
- **Mouse**: left = apply tool (drag to keep applying) · right-drag = orbit · middle-drag or shift-drag = pan · wheel = zoom
- **Trackpad**: two-finger scroll / pinch = zoom · alt/option-drag or alt+scroll = orbit · shift-drag = pan
- **Keys**: `1`/`2`/`3`/`4` (or `B`/`E`/`P`/`X`) pen/eraser/paint/box · `Tab` next tool · `[` `]` prev/next color · `⌘Z` undo · `⇧⌘Z` / `⌘Y` redo · `⌘S` save · `⇧⌘S` save as · `⌘O` open · `F` reset view · `G` toggle grid · `W` voxel outlines · `C` perspective/orthographic · hold `Space` + drag to orbit
- The corner readout shows the camera projection and the `x y z` under the pointer.
- Box tool: drag a footprint, release, move to set the height, click to place (`Esc` cancels).
- Palette: click to select, double-click to edit (repaints all voxels using it), `+` adds a color.

## Saving
Scenes are versioned JSON files stored server-side in `saves/` (`VOXER_SCENES` overrides the directory).
**Save** writes straight to the current scene — it only asks for a name the first time; **Save As…** always
asks; **Open…** lists what's saved. The status bar shows the scene name and a `*` when there are unsaved
changes. Format and its compatibility rules: `docs/FORMAT.md`.

## Layout
- `src/core/` — pure logic, no DOM: `Editor` (all state + events), `VoxelGrid` (32³ `Uint8Array` by default, up to 256³), `Palette`, `Raycast` (DDA voxel traversal + floor/wall planes), `Tools`, `History` (undo/redo strokes), `Scene` (versioned save format)
- `src/render/` — Three.js: chunked meshing with face culling, grid lines, orbit camera, viewport
- `src/ui/` — views over the Editor (palette panel, toolbar, status bar, color picker, scene bar) and `InputController` (mouse/trackpad/keyboard bindings)
- `server/index.ts` — static file server (`Bun.serve`) + `/api/scenes` save/load endpoints
- `test/` — `bun test` suites for core, mesher, grid lines and server

`window.voxer` exposes `{ editor, view, scenes }` in the browser console for debugging.
