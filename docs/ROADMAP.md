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

## Next (in rough priority)
- [ ] Save / load sidebar buttons (format + `/api/scenes/:name` exist)
- [ ] Agent: silhouette carving tool (visual hull from front/side/top reference crops)
- [ ] Agent: reference overlay on the live viewport; per-view reference crops in snapshots
- [ ] Agent: MCP resource/prompt for the voxelize workflow (works outside Claude Code)
- [ ] Box/line drawing modes for pen & eraser (click-drag rectangles)
- [ ] Color picker: eyedropper (pick color from a voxel), recent colors
- [ ] Fill tool (flood fill connected same-color voxels)
- [ ] Camera: zoom-to-cursor, frame-all (`F` frames content when non-empty)
- [ ] Export (glTF / OBJ)
- [ ] Optional: greedy meshing if chunks get heavy; palette-texture shader so recolor needs no remesh

## Non-goals for now
Mobile/touch, multi-user, very small screens.
