# src/core — pure logic (no DOM, no Three.js)

| File | What | Key API |
|---|---|---|
| `Editor.ts` | **All mutable state** + typed events (`voxels`, `tool`, `color`, `palette`, `reset`) | `setTool`, `setColor/stepColor/addColor`, `applyTool(hit)`, `beginStroke(viewDir?)/endStroke`, `strokePlane`, `undo/redo`, `previewCell(hit)`, `run(ops)`, `applyEdits`, `info`, `dumpLayer`, `serialize/load/newScene`, `setRaw` (no history) |
| `Commands.ts` | Batch drawing ops planned on a `Draft` overlay → `Edit[]` | `Op` union, `planOps`, `applyOp`, `layerCell` (ASCII slice layout), `dumpLayer`, `boundingBox` |
| `Scene.ts` | Save/sync format | `SceneData`, `encodeCells/decodeCells` (RLE + base64) |
| `VoxelGrid.ts` | 32³ default (max 256³) `Uint8Array`; 0 = empty | `get/set/erase/has/inBounds/count/occupied()/setAll` |
| `Palette.ts` | hex color list, 32 defaults, max 255 | `add/update/get/all/replaceAll`, `resolve(hex\|index)` (match, append, or nearest when full), `toCell/fromCell`, `hexToRgb/rgbToHex/normalizeHex` |
| `Raycast.ts` | DDA through grid → `Hit {cell, normal, voxel, t}`; floor/walls are hits with `voxel:false` and cell just outside grid (`y:-1` / `z:-1` / `x:-1`) | `raycastGrid(grid, origin, dir)` |
| `Tools.ts` | `ToolName = pen \| eraser \| paint`; `Edit {x,y,z,before,after}` | `targetCell`, `planEdit`, `applyEdit`, `revertEdit`, `dominantAxis`, `inPlane` |
| `History.ts` | undo/redo of edit strokes | `beginStroke/apply/endStroke/undo/redo` |
| `Emitter.ts` | tiny typed event emitter | `on(event, fn) → off`, `emit` |

Invariants: cell value = palette index + 1; pen never overwrites; eraser/paint only act on voxels;
a **pen drag is plane-locked**: `beginStroke(viewDir)` picks the lock axis with `dominantAxis` (the
plane most facing the camera — `"y"`, the ground, when looking top-down, and when no `viewDir` is
given), the first voxel placed fixes that plane's offset, and later cells (plus the ghost from
`previewCell`) are rejected off it. Read it via `Editor.strokePlane`; cleared by `beginStroke`/`endStroke`;
`Editor` is the only thing that mutates the grid outside tests. `editor.grid` is a getter — `load`/`newScene`
swap in a new grid (and history) and emit `reset`, so don't cache it across those. Adding a tool: see `/add-tool` skill.
