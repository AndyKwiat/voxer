# src/core — pure logic (no DOM, no Three.js)

| File | What | Key API |
|---|---|---|
| `Editor.ts` | **All mutable state** + typed events (`voxels`, `tool`, `color`, `palette`, `reset`) | `setTool`, `setColor/stepColor/addColor`, `applyTool(hit)`, `beginStroke(viewDir?)/endStroke`, `strokePlane`, `undo/redo`, `previewCell(hit)`, `run(ops)`, `runReport(ops)`, `applyEdits`, `info`, `dumpLayer`, `serialize/load/newScene`, `setRaw` (no history) |
| `Commands.ts` | Batch drawing ops planned on a `Draft` overlay → `Edit[]` | `Op` union, `planOps`, `planOpsReport`, `applyOp`, `Draft` (`beginOp`/`report`), `layerCell` (ASCII slice layout), `dumpLayer`, `boundingBox` |
| `Report.ts` | Write reports for op batches: `Draft.set` feeds a `WriteTracker` (ops bracketed by `Draft.beginOp`), so every op — including new ones — is counted | `WriteReport` (`totals`, `ops[]`, `warnings`, `notes`), `formatReport`, `summarizeReport`; `planOpsReport` / `Editor.runReport` produce it |
| `Lint.ts` | Model checks on a grid (pure, typed arrays over the padded content bbox; ~0.5 s worst case at 256³) | `lint(grid, paletteHex[], opts)` → components/specks/floating, enclosed air pockets, boundary contact, x/z mirror symmetry, unused/near-duplicate colors, `warnings`, `summary` |
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

Write reports (`Report.ts`): counts are per cell, not per write call. Per op: `set` (empty → filled), `erased`,
`recolored`, `noop` (written but unchanged), `clipped` (filled writes at integer coords outside the grid, with
`clipBox`; solids report the out-of-grid part of the shape, estimated with `clipApprox` past 4M cells; erasing
outside the grid is not a clip), `invalid` (non-integer coords), and `overwrote` = earlier ops in the same batch
whose cells this op erased/recolored. Totals compare the grid before the batch with the result (so cells drawn
then erased in one batch are net no-ops). Warnings: clipping, then erasing what an earlier op drew; recoloring
an earlier op's cells is a note. A new op gets all of this for free as long as it writes through `Draft.set`.
