# Roadmap

## Done
- Core model (grid, palette, DDA raycast, tools, stroke undo/redo, Editor events)
- Three.js viewport: chunked meshing, grid floor + walls, orbit camera, ghost cube
- Sidebar: tools, scrollable palette with add/edit picker (hex + RGB), status bar
- Mouse / trackpad / keyboard controls
- Static Bun server, unit tests, headless browser check
- Voxel outline toggle (`W`)
- Save / load: versioned JSON scenes (`docs/FORMAT.md`), `/api/scenes` endpoints, Open / Save / Save As

## Next (in rough priority)
- [ ] Scene deletion / rename in the Open dialog; warn before discarding unsaved changes
- [ ] Save the camera in the scene file (additive `camera` field — no version bump)
- [ ] Load a scene whose `size` differs from the current grid (needs a swappable `Editor.grid`)
- [ ] Box/line drawing modes for pen & eraser (click-drag rectangles)
- [ ] Color picker: eyedropper (pick color from a voxel), recent colors
- [ ] Fill tool (flood fill connected same-color voxels)
- [ ] Camera: zoom-to-cursor, frame-all (`F` frames content when non-empty)
- [ ] Export (glTF / OBJ)
- [ ] Optional: greedy meshing if chunks get heavy; palette-texture shader so recolor needs no remesh

## Non-goals for now
Mobile/touch, multi-user, very small screens.
