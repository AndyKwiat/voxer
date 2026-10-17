# Roadmap

## Done
- Core model (grid, palette, DDA raycast, tools, stroke undo/redo, Editor events)
- Three.js viewport: chunked meshing, grid floor + walls, orbit camera, ghost cube
- Sidebar: tools, scrollable palette with add/edit picker (hex + RGB), status bar
- Mouse / trackpad / keyboard controls
- Static Bun server, unit tests, headless browser check
- Batch drawing ops (`core/Commands`), `Editor.run/load/serialize/newScene`, RLE scene format
- Agent control: MCP server (`mcp/`), WebSocket hub, `window.voxer.api`, multi-view snapshot sheets with
  rulers, reference image (paste/drop/file) + sampling, scene save/load + autosave, `/voxelize` skill
- Sidebar New / Save / Load (`ui/ScenePanel`)
- Agent tooling for building many models fast:
  - Scratch mode (`VOXER_SCRATCH=1`): private in-memory server, never touches `models/` or the user's tab;
    `save_scene`/`load_scene {path}`; `scripts/lib/headless.ts` for scripts
  - Sturdier snapshots (per-attempt timeout → smaller retry → headless relaunch, reported as `DEGRADED`);
    `figure: true` scale person in snapshots
  - Architecture parts library (`core/Parts`): roof/walls/window/door/pillar/beam/railing/stairs/arch/crenels/
    lantern, box `pattern`s, `stamp` (paste saved scenes with rot/mirror/recolor/reshade); `examples/house.json`
  - Write reports for draw/run/run_script (clipping, same-batch erasures, per-op counts) and `lint`
    (components/specks/floating, air pockets, boundary contact, symmetry, palette)
  - Material slots (shade ramps, `recolor_slot`, `make_variant`) and anchors (door/roof_top/seat…, drawn in
    snapshots); scene format v2
  - Recipe files as first-class input (`bun run recipe`, MCP `build_recipe`, `recipes/README.md`)
  - Mesh export: greedy-merged mesh with baked AO → GLB / OBJ / JSON (`export_mesh`, sidebar "Export .glb")

## Next (in rough priority)
- [ ] Agent: silhouette carving tool (visual hull from front/side/top reference crops)
- [ ] Agent: reference overlay on the live viewport; per-view reference crops in snapshots
- [ ] Agent: MCP resource/prompt for the voxelize workflow (works outside Claude Code)
- [ ] Box/line drawing modes for pen & eraser (click-drag rectangles)
- [ ] Color picker: eyedropper (pick color from a voxel), recent colors
- [ ] Fill tool (flood fill connected same-color voxels)
- [ ] Camera: zoom-to-cursor, frame-all (`F` frames content when non-empty)
- [ ] Viewport colour space: the live view feeds sRGB palette colours as linear (looks paler than exports)
- [ ] Optional: use `core/GreedyMesher` for viewport chunks if they get heavy; palette-texture shader so recolor needs no remesh
- [ ] Parts: ops returning metadata from `run` (e.g. roof ridge y); `stamp` by name inside `run_script`; more
      styles (moon doors, eave brackets)
- [ ] Slots/anchors: anchors in the live viewport; undo for palette/slot edits; `remove_slot`
- [ ] Recipes: sheets for variants, watch mode (rebuild on save), a `ctx` helper library (ball/disc/line)
- [ ] Root cause of the rare SwiftShader snapshot stall (not reproducible; retries cover it)

## Non-goals for now
Mobile/touch, multi-user, very small screens.
