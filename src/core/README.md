# src/core — pure logic (no DOM, no Three.js)

| File | What | Key API |
|---|---|---|
| `Editor.ts` | **All mutable state** + typed events (`voxels`, `tool`, `color`, `palette`, `reset`, `meta`) | `setTool`, `setColor/stepColor/addColor`, `applyTool(hit)`, `beginStroke(viewDir?)/endStroke`, `strokePlane`, `undo/redo`, `previewCell(hit)`, `run(ops)`, `applyEdits`, `info`, `dumpLayer`, `serialize/load/newScene`, `setRaw` (no history); slots: `slots`, `listSlots`, `defineSlot`, `adoptSlot`, `recolorSlot`, `makeVariant`; anchors: `anchors`, `setAnchor`, `removeAnchor` |
| `Commands.ts` | Batch drawing ops planned on a `Draft` overlay → `Edit[]` | `Op` union, `planOps`, `applyOp`, `layerCell` (ASCII slice layout), `dumpLayer`, `boundingBox` |
| `Scene.ts` | Save/sync format (v1; v2 when slots/anchors exist) | `SceneData`, `SCENE_VERSIONS`, `encodeCells/decodeCells` (RLE + base64) |
| `Slots.ts` | Named material slots = palette shade ramps (pure) | `shade`, `fitFactor`, `deriveRamp`, `uniqueHex`, `planDefineSlot/planAdoptSlot`, `recolorSlot`, `variantScene`, `parseSlots`, `slotSummary` |
| `Anchors.ts` | Named anchor cells with optional `dir`/`note` (pure) | `Anchor`, `checkAnchor`, `parseAnchors`, `dirVector`, `anchorMoves(anchors, ops)` |
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
swap in a new grid (and history) and emit `reset`, so don't cache it across those.

**Slots** (`slots` in the scene): each owns palette indices (`shades: {base: {index, factor: 1}, dark: {index, factor: 0.74}}`).
Slot colors are nudged ±1 per channel to stay unique in the palette, so painting with a returned hex resolves to the slot's
own entry. `recolorSlot` rewrites those entries (`shade(base, factor)`) in one `replaceAll` → one `palette` event; voxels
follow because cells store indices. Palette changes that remove a slot's index drop the slot. Slot/palette edits are not undoable
(like `set_palette`). **Anchors**: a moving `translate` op carries them (all, or those inside its box; `copy` doesn't), and
undo/redo of that step moves them back (tracked per stroke by its first `Edit`); `mirror`/`clear`/drawing ops and `run_script`
don't move them; `newScene` clears slots and anchors; `load` replaces them. Both emit `meta` (the Bridge pushes the scene on it). Adding a tool: see `/add-tool` skill.
