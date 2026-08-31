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
| `core/Tools` | pen/eraser/paint: `targetCell`, `planEdit` (pure), `applyEdit/revertEdit` | pen = hit + normal; eraser/paint = hit cell (voxels only) |
| `core/History` | stroke-grouped undo/redo stack (limit 200) | `beginStroke/apply/endStroke` |
| `core/Editor` | owns everything above + tool/color; typed events | the only mutable-state owner |
| `render/ChunkMesher` | 16³ chunks, exposed-face meshes with vertex colors, dirty tracking | rebuilt lazily in the render loop |
| `render/GridLines` | floor + 2 walls, lines split into 16-unit pieces | split works around SwiftShader clipping bug |
| `render/OrbitCamera` | spherical orbit around a target; rotate/pan/zoom | `F` resets |
| `render/Viewport` | scene, lights, ghost cube, pick(), render-on-demand loop | subscribes to Editor |
| `ui/InputController` | all bindings (see CONTROLS.md) | the only place that reads pointer/keyboard |
| `ui/*` | DOM views | stateless; re-render from events |
| `server/index.ts` | `Bun.serve` static files, traversal-safe | add `/api/*` routes here |

## Performance model
- Edits are O(1) + one chunk remesh (≤16³ cells). Palette edits remesh all non-empty chunks.
- Render loop only draws when `invalidate()` was called.
- The default 32³ grid is 32 KB and cheap to scan; at the 256³ max it is a 16 MB grid where iterating all cells (`occupied()`) is ~20 ms — avoid in hot paths.

## Dependencies
- `three` — scene graph, camera math, WebGL. Writing raw WebGL would cost far more code for no user benefit.
- dev: `typescript`, `@types/three`, `@types/bun`.

## Future: save/load (planned)
Serialize `{ size, palette: string[], data: base64|RLE of grid.data }`; load via `editor.setRaw` or a
bulk `Editor.load()` that emits one `voxels` event covering all changed cells. Endpoints go in `server/index.ts`.
