# Roadmap

## Done
- Core model (grid, palette, DDA raycast, tools, stroke undo/redo, Editor events)
- Three.js viewport: chunked meshing, grid floor + walls, orbit camera, ghost cube
- Sidebar: tools, scrollable palette with add/edit picker (hex + RGB), status bar
- Mouse / trackpad / keyboard controls
- Static Bun server, unit tests, headless browser check

## Next (in rough priority)
- [ ] Save / load: JSON format (see ARCHITECTURE.md), `GET/PUT /api/scenes/:name`, sidebar buttons
- [ ] Bulk `Editor.load()` that emits a single `voxels` event
- [ ] Box/line drawing modes for pen & eraser (click-drag rectangles)
- [ ] Color picker: eyedropper (pick color from a voxel), recent colors
- [ ] Fill tool (flood fill connected same-color voxels)
- [ ] Camera: zoom-to-cursor, frame-all (`F` frames content when non-empty)
- [ ] Export (glTF / OBJ)
- [ ] Optional: greedy meshing if chunks get heavy; palette-texture shader so recolor needs no remesh

## Non-goals for now
Mobile/touch, multi-user, very small screens.
