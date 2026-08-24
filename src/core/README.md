# src/core — pure logic (no DOM, no Three.js)

| File | What | Key API |
|---|---|---|
| `Editor.ts` | **All mutable state** + typed events | `setTool`, `setColor/stepColor/addColor`, `applyTool(hit)`, `beginStroke/endStroke`, `undo/redo`, `previewCell(hit)`, `setRaw` (no history) |
| `VoxelGrid.ts` | 256³ `Uint8Array`; 0 = empty | `get/set/erase/has/inBounds/count/occupied()` |
| `Palette.ts` | hex color list, 32 defaults, max 255 | `add/update/get/all`, `toCell/fromCell`, `hexToRgb/rgbToHex/normalizeHex` |
| `Raycast.ts` | DDA through grid → `Hit {cell, normal, voxel, t}`; floor/walls are hits with `voxel:false` and cell just outside grid (`y:-1` / `z:-1` / `x:-1`) | `raycastGrid(grid, origin, dir)` |
| `Tools.ts` | `ToolName = pen \| eraser \| paint`; `Edit {x,y,z,before,after}` | `targetCell`, `planEdit`, `applyEdit`, `revertEdit` |
| `History.ts` | undo/redo of edit strokes | `beginStroke/apply/endStroke/undo/redo` |
| `Emitter.ts` | tiny typed event emitter | `on(event, fn) → off`, `emit` |

Invariants: cell value = palette index + 1; pen never overwrites; eraser/paint only act on voxels;
`Editor` is the only thing that mutates the grid outside tests. Adding a tool: see `/add-tool` skill.
