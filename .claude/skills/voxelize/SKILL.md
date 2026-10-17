---
name: voxelize
description: Build a voxel model in Voxer from a reference image and/or a description, using the voxer MCP tools (draw, snapshot, sample_reference…). Use when asked to make, model, sculpt or recreate something as voxels.
---

# Voxelize: reference image + prompt → voxel model

You drive the app through the `voxer` MCP tools (`mcp__voxer__*`). It runs headless unless the user is
watching; `open_viewer` opens their browser on the live scene. Conventions: integer cells, **Y up**,
the model's **front faces +Z** (the `front` view), x grows to the right in that view.

Run the MCP server in **scratch mode** (`VOXER_SCRATCH=1`) when building throwaway or batch models, so nothing
lands in the user's `models/` or their open tab; save results with `save_scene {path}` into the project.

For models you'll rebuild, vary or make many of, write a **recipe file** (see `recipes/README.md`,
`recipes/examples/`) instead of ad-hoc draw calls, then `build_recipe {path}`. Check the per-model warnings, look at
the returned sheet, edit the file and rebuild.

## 1. Understand the target
- Reference: if the user pasted an image in chat you can already see it — also save it with
  `set_reference {path}` if you have a file path; if they pasted it **into the app**, call `get_reference`.
- Write down (briefly): what the object is, which view the image shows (front? 3/4?), key proportions
  (height : width : depth), symmetric axis, 4–10 main colors, and the parts list (e.g. cap, stem, spots).
- Pick a grid size: 32 for simple props/characters, 48–64 when there's fine detail. `new_scene {size}`.
  Plan the bounding box (e.g. a 32-grid figure ~24 tall, centered at x=16, z=16, standing on y=0).

## 2. Block out (one `draw` batch)
Big primitives first: `box`, `ellipsoid`, `cylinder`, `line` (with `radius` for limbs/branches).
Use hex colors directly; they're added to the palette. Carve with `erase: true`. Then `snapshot`.

**Read the `draw` result.** Leading `WARNING:` lines mean something went silently wrong: "clipped outside the
grid" = part of the model was cut off (move it or grow the grid); "erased N cells set by op K" = a later op
carved away earlier work. (`note:` lines, e.g. a door cutting its wall, are expected.)

**Buildings and architecture:** use the parts ops instead of hand-placing voxels — `walls` → `door`/`window` →
`pillar`/`beam`/`lantern` → `roof` (y = wall top + 1; the ridge ends at y + number of layers; `maxLayers:3,
steps:[1,1,1], ridge:false` makes a skirt roof between storeys), plus `stairs`, `railing`, `arch` (carves),
`crenels`, and box `pattern: "brick"|"checker"|"stripes"|"noise"`. Start from `examples/house.json`. Reuse pieces
with `save_scene {name}` + `{op: "stamp", scene: "<name>", at, rot}`.

**Colour variants:** call `define_slot` first (e.g. `roof`, base + `{dark: 0.74, light: 1.22}`) and paint only with
the returned hexes; later `make_variant {slots: {roof: "#e8b830"}, path}` writes a recoloured copy.

## 3. Use the image directly when it fits
`sample_reference {cols, maxColors}` (crop to the part you want, `crop` in 0..1 fractions) returns
`{grid, legend}` — paste it as a `layer` op (`axis: "z"` for a front view, repeated over several `index`
values to extrude). Good for flat/front-facing art, logos, faces, the front silhouette of a character.
Then carve depth with `left`/`top` silhouettes (erase cells outside them) and round edges.

## 4. Refine
- `layer` ops are the precise tool: ASCII rows exactly as the matching snapshot view shows them
  (`y` = top view, row 0 = back; `z` = front view, top row first; `x` = left view). `get_layer` dumps a
  slice in the same format — edit and draw it back.
- Symmetry: build one half, then `mirror {axis:"x", pivot}` (cell c → pivot−c; centered on cell 16 → 32).
- Repeated parts: `translate {copy:true, min, max, offset}`. Procedural (spirals, noise, tapered shapes):
  `run_script`.
- Shade for depth: slightly darker color on undersides/creases, lighter on top edges — voxel art reads
  best with 2–3 tones per material.

## 5. Compare and iterate (do this every pass)
`snapshot {reference: true}` → list concrete differences ("cap 2 cells too narrow at y=14", "spots
missing on the left side", "stem color too yellow"), fix them in one `draw`, repeat. Use the ruler
numbers (cell coordinates) to target fixes. Check `iso` and `iso_left`/`iso_back` for back/side gaps.
Stop when the silhouette, proportions and colors match from front, side and top. `undo` freely.
Add `figure: true` to snapshots to judge door heights and proportions against an 8-cell-tall person.

## 6. Finish
- `lint` and fix specks, floating pieces and boundary contact (its symmetry pivot works with `mirror`).
- Mark points a game needs with `set_anchor` (`door` with `dir: "+z"`, `roof_top`, `seat`, `pivot`); check them in
  a `snapshot`.
- `save_scene {name}` (→ `models/<name>.json`) or `{path}`; `export_mesh {format: "glb", path}` if a mesh is wanted.
- Show a final `snapshot`, and tell the user they can `open_viewer` (or open http://localhost:3005) to orbit it.
