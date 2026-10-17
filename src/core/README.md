# src/core — pure logic (no DOM, no Three.js)

| File | What | Key API |
|---|---|---|
| `Editor.ts` | **All mutable state** + typed events (`voxels`, `tool`, `color`, `palette`, `reset`, `meta`) | `setTool`, `setColor/stepColor/addColor`, `applyTool(hit)`, `beginStroke(viewDir?)/endStroke`, `strokePlane`, `undo/redo`, `previewCell(hit)`, `run(ops)`, `resolver()`, `applyEdits`, `info`, `dumpLayer`, `serialize/load/newScene`, `setRaw` (no history); slots: `slots`, `listSlots`, `defineSlot`, `adoptSlot`, `recolorSlot`, `makeVariant`; anchors: `anchors`, `setAnchor`, `removeAnchor` |
| `Commands.ts` | Batch drawing ops planned on a `Draft` overlay → `Edit[]` | `Op` union, `planOps`, `applyOp`, `layerCell` (ASCII slice layout), `dumpLayer`, `boundingBox` |
| `Parts.ts` | Architecture parts library, dispatched from `Commands.applyOp`: `roof` (hip/gable, Chinese curve, shade ramp), `walls`, `window`, `door`, `pillar`, `beam`, `railing`, `stairs`, `arch`, `crenels`, `lantern`, `stamp` (paste SceneData: rot/mirror/recolor/reshade), and `pattern` fills for `box`/`walls` | `PartOp`, `applyPartOp`, `patternFn`, `roofLayout` (layers + ridge y), `stampCells`, `shade`, `roofRamp`, `hash3`, `withHexOf`, `MATERIALS` |
| `Scene.ts` | Save/sync format (v1; v2 when slots/anchors exist) | `SceneData`, `SCENE_VERSIONS`, `encodeCells/decodeCells` (RLE + base64) |
| `Slots.ts` | Named material slots = palette shade ramps (pure) | `shade`, `fitFactor`, `deriveRamp`, `uniqueHex`, `planDefineSlot/planAdoptSlot`, `recolorSlot`, `variantScene`, `parseSlots`, `slotSummary` |
| `Anchors.ts` | Named anchor cells with optional `dir`/`note` (pure) | `Anchor`, `checkAnchor`, `parseAnchors`, `dirVector`, `anchorMoves(anchors, ops)` |
| `VoxelGrid.ts` | 32³ default (max 256³) `Uint8Array`; 0 = empty | `get/set/erase/has/inBounds/count/occupied()/setAll` |
| `Palette.ts` | hex color list, 32 defaults, max 255 | `add/update/get/all/replaceAll`, `resolve(hex\|index)` (match, append, or nearest when full), `toCell/fromCell`, `hexToRgb/rgbToHex/normalizeHex` |
| `Raycast.ts` | DDA through grid → `Hit {cell, normal, voxel, t}`; floor/walls are hits with `voxel:false` and cell just outside grid (`y:-1` / `z:-1` / `x:-1`) | `raycastGrid(grid, origin, dir)` |
| `Tools.ts` | `ToolName = pen \| eraser \| paint`; `Edit {x,y,z,before,after}` | `targetCell`, `planEdit`, `applyEdit`, `revertEdit`, `dominantAxis`, `inPlane` |
| `History.ts` | undo/redo of edit strokes | `beginStroke/apply/endStroke/undo/redo` |
| `Emitter.ts` | tiny typed event emitter | `on(event, fn) → off`, `emit` |
| `GreedyMesher.ts` | Export mesher: exposed faces, per-vertex AO baked into **linear** vertex colors (AO levels 0.5/0.68/0.84/1, bottom faces ×0.8), quads split on the brighter diagonal, greedy merge only where color + all 4 corner AO values match (identical visuals). Same output as Waldo's `voxels.js` | `meshGrid(grid, palette, {pivot, scale, ao, merge, remap, bottomShade}) → MeshData` (typed arrays + bbox), `aoLevel`, `srgbToLinear/linearToSrgb` |
| `MeshExport.ts` | Hand-written writers: GLB (glTF 2.0, COLOR_0 linear float), OBJ (`v x y z r g b`, sRGB), compact JSON (base64 typed arrays) | `exportMesh(grid, palette, {format, …}) → {bytes, mime, extension, stats}`, `toGLB`, `toOBJ`, `toMeshJSON`, `bytesToBase64` |

Invariants: cell value = palette index + 1; pen never overwrites; eraser/paint only act on voxels;
a **pen drag is plane-locked**: `beginStroke(viewDir)` picks the lock axis with `dominantAxis` (the
plane most facing the camera — `"y"`, the ground, when looking top-down, and when no `viewDir` is
given), the first voxel placed fixes that plane's offset, and later cells (plus the ghost from
`previewCell`) are rejected off it. Read it via `Editor.strokePlane`; cleared by `beginStroke`/`endStroke`;
`Editor` is the only thing that mutates the grid outside tests. `editor.grid` is a getter — `load`/`newScene`
swap in a new grid (and history) and emit `reset`, so don't cache it across those.

**Slots** (`slots` in the scene): each owns palette indices (`shades: {base: {index, factor: 1}, dark: {index, factor: 0.74}}`).
Slot colors are nudged ±1 per channel to stay unique in the palette, so painting with a returned hex resolves to the slot's
own entry. `recolorSlot` rewrites those entries (`shade(base, factor)`) in one `replaceAll` → one `palette` event; voxels
follow because cells store indices. Palette changes that remove a slot's index drop the slot. Slot/palette edits are not undoable
(like `set_palette`). **Anchors**: a moving `translate` op carries them (all, or those inside its box; `copy` doesn't), and
undo/redo of that step moves them back (tracked per stroke by its first `Edit`); `mirror`/`clear`/drawing ops and `run_script`
don't move them; `newScene` clears slots and anchors; `load` replaces them. Both emit `meta` (the Bridge pushes the scene on it). Adding a tool: see `/add-tool` skill.

Parts library conventions (`Parts.ts`): wall-mounted parts take `at` = bottom-left cell of the opening **on**
the wall surface plus `face` (`"+z"` front by default; along the face is +x on z faces, +z on x faces) and
recess one cell into the wall. Colors default to the village `MATERIALS`; derived shades (`shade(hex, f)`,
multiplicative like waldo's colors.js) need a hex, so the resolver passed to `planOps` may carry `hexOf`
(`Editor.resolver()` does) — without it, palette-index colors are used unshaded. Randomness (mottle, noise,
brick highlights) is a cell hash (`hash3` + `seed`), so results don't depend on op order. `roofLayout`
reports the layers and the ridge height (`y + layers`). `stamp` only accepts SceneData; saved-scene
names are resolved by `agent/Api.run`. Example building: `examples/house.json`.
