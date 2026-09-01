# Architecture

## Data flow
```
 pointer/keys ──► InputController ──► Editor (state + History) ──events──► Viewport (Three.js)
                        │                 ▲                          └────► PalettePanel / Toolbar / StatusBar
                        └── Viewport.pick ┘  (DDA raycast through VoxelGrid → Hit)
```
- `Editor.applyTool(hit)` → `Tools.planEdit` decides the target cell and new value → `History.apply`
  mutates the grid and records the edit → `voxels` event → `Viewport` marks the chunk dirty.
- Undo/redo replay recorded `Edit`s (`{x,y,z,before,after}`) and emit the same `voxels` event, so
  rendering has exactly one code path.

## Modules
| Module | Responsibility | Notes |
|---|---|---|
| `core/VoxelGrid` | 32³ default (max 256³) `Uint8Array`, bounds checks, occupied count/iterator | index = `(y*S + z)*S + x` |
| `core/Palette` | ordered hex colors, add/update, hex⇄RGB | `onChange` set; `toCell/fromCell` |
| `core/Raycast` | Amanatides–Woo DDA; returns first voxel **or** floor/wall plane hit with face normal | pen on empty space places on floor/walls because those planes are hits with `voxel:false` |
| `core/Tools` | pen/eraser/paint/box: `targetCell`, `planEdit` (pure), `applyEdit/revertEdit`, box regions | pen = hit + normal; eraser/paint = hit cell (voxels only); box = `makeBoxRegion` + `planBoxEdits` |
| `core/History` | stroke-grouped undo/redo stack (limit 200) | `beginStroke/apply/endStroke` |
| `core/Editor` | owns everything above + tool/color + scene name/dirty; typed events | the only mutable-state owner |
| `core/Scene` | versioned save format: `encodeScene`/`decodeScene`, RLE, migrations | see `docs/FORMAT.md` |
| `render/ChunkMesher` | 16³ chunks, exposed-face meshes with vertex colors, dirty tracking | rebuilt lazily in the render loop |
| `render/GridLines` | floor + 2 walls, lines split into 16-unit pieces | split works around SwiftShader clipping bug |
| `render/OrbitCamera` | spherical orbit around a target; rotate/pan/zoom; perspective + orthographic in one pose | `F` resets, `C` swaps projection |
| `render/Viewport` | scene, lights, ghost cube, pick(), render-on-demand loop | subscribes to Editor |
| `ui/InputController` | all bindings (see CONTROLS.md) | the only place that reads pointer/keyboard |
| `ui/SceneBar` | Open / Save / Save As buttons + `scenesApi` fetch calls + modal dialogs | scene name lives on `Editor`, not here |
| `ui/*` | DOM views | stateless; re-render from events |
| `server/index.ts` | `Bun.serve` static files + `/api/scenes` CRUD, traversal-safe | scenes in `saves/` (`VOXER_SCENES` overrides) |

## Performance model
- Edits are O(1) + one chunk remesh (≤16³ cells). Palette edits remesh all non-empty chunks.
- Render loop only draws when `invalidate()` was called.
- The default 32³ grid is 32 KB and cheap to scan; at the 256³ max it is a 16 MB grid where iterating all cells (`occupied()`) is ~20 ms — avoid in hot paths.

## Dependencies
- `three` — scene graph, camera math, WebGL. Writing raw WebGL would cost far more code for no user benefit.
- dev: `typescript`, `@types/three`, `@types/bun`.

## Save / load
`Editor.toScene()` → `Scene.encodeScene` → `PUT /api/scenes/:name`; opening does the reverse through
`Editor.loadScene(doc, name)`, which validates, replaces grid + palette, drops undo history and emits a
**single** `voxels` event covering every changed cell (so the viewport remeshes once). The format and its
compatibility rules are in `docs/FORMAT.md` — read that before adding a field.

`Editor` owns `sceneName` and `dirty`; the `scene` event carries both. "Save" writes to `sceneName` and
only prompts when there isn't one; "Save As" always prompts. Scenes live in `saves/` on the server, so
they survive a reload and are not per-browser.
