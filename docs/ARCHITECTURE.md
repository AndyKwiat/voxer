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
- Batch ops: `Editor.run(ops)` → `Commands.planOps` (a `Draft` overlay; later ops see earlier ones) →
  `applyEdits` = one history stroke + one `voxels` event. `load`/`newScene` replace the grid and emit
  `reset`; `Viewport` rebuilds grid lines + meshes on it.

## Agent control
```
Claude ─stdio MCP─► mcp/server.ts ─POST /api/rpc─► server Hub ─WS /agent─► active page: Bridge → Api
                       │ starts the app server if none                    (Editor + Viewport: edits,
                       └ launches headless Chrome if no page               snapshots, reference sampling)
```
- The page is the only scene owner; the hub keeps the last scene the active page pushed (and autosaves
  it to `models/_autosave.json`) so a newly active page (new tab, reload, headless→visible) starts in sync.
- Snapshots (`render/Capture.ts`) render with temporary cameras into the live renderer and copy out in
  the same task, so the visible view is untouched. Axis views are orthographic, unlit (exact palette
  colors), transparent-background, composited over a 2D cell grid with coordinate rulers.

## Modules
| Module | Responsibility | Notes |
|---|---|---|
| `core/VoxelGrid` | 32³ default (max 256³) `Uint8Array`, bounds checks, occupied count/iterator | index = `(y*S + z)*S + x` |
| `core/Palette` | ordered hex colors, add/update, hex⇄RGB | `onChange` set; `toCell/fromCell` |
| `core/Raycast` | Amanatides–Woo DDA; returns first voxel **or** floor/wall plane hit with face normal | pen on empty space places on floor/walls because those planes are hits with `voxel:false` |
| `core/Tools` | pen/eraser/paint: `targetCell`, `planEdit` (pure), `applyEdit/revertEdit` | pen = hit + normal; eraser/paint = hit cell (voxels only) |
| `core/History` | stroke-grouped undo/redo stack (limit 200) | `beginStroke/apply/endStroke` |
| `core/Commands` | batch ops (box, ellipsoid, cylinder, line, layer, set, mirror, translate, replace_color, clear), `dumpLayer`, bbox | pure; atomic per batch |
| `core/Scene` | `SceneData` + RLE/base64 cell codec | save/load/sync format |
| `core/Editor` | owns everything above + tool/color; typed events | the only mutable-state owner; grid replaced by `load`/`newScene` |
| `render/ChunkMesher` | 16³ chunks, exposed-face meshes with vertex colors, dirty tracking | rebuilt lazily in the render loop |
| `render/GridLines` | floor + 2 walls, lines split into 16-unit pieces | split works around SwiftShader clipping bug |
| `render/OrbitCamera` | spherical orbit around a target; rotate/pan/zoom | `F` resets |
| `render/Viewport` | scene, lights, ghost cube, pick(), render-on-demand loop, `renderOffscreen` | subscribes to Editor |
| `render/Views`, `render/Capture` | named views + ortho framing math (pure); contact-sheet snapshots | |
| `agent/*` | `window.voxer.api`, WebSocket bridge, reference image | see `src/agent/README.md` |
| `ui/InputController` | all bindings (see CONTROLS.md) | the only place that reads pointer/keyboard |
| `ui/*` | DOM views | stateless; re-render from events |
| `server/index.ts` | `Bun.serve` static files (traversal-safe) + `/api/*` + `/agent` WS | |
| `server/Hub`, `server/Store` | agent routing / active page; scenes, reference, autosave in `models/` | |
| `mcp/server.ts` | MCP stdio server; hand-rolled JSON-RPC (no SDK dependency) | tools in `mcp/tools.ts` |

## Performance model
- Edits are O(1) + one chunk remesh (≤16³ cells). Palette edits remesh all non-empty chunks.
- Render loop only draws when `invalidate()` was called.
- The default 32³ grid is 32 KB and cheap to scan; at the 256³ max it is a 16 MB grid where iterating all cells (`occupied()`) is ~20 ms — avoid in hot paths.

## Dependencies
- `three` — scene graph, camera math, WebGL. Writing raw WebGL would cost far more code for no user benefit.
- dev: `typescript`, `@types/three`, `@types/bun`.

## Save/load
`Editor.serialize()` → `SceneData { version: 1, size, palette, data }` (`data` = RLE + base64 of the
grid cells); `Editor.load(scene)`. Server: `GET/PUT /api/scenes/:name` → `models/<name>.json`. Used today
by the MCP `save_scene`/`load_scene` tools and the sidebar New / Save / Load buttons (`ui/ScenePanel`).

## Why no MCP SDK
The MCP stdio transport is newline-delimited JSON-RPC with four methods we need (`initialize`,
`tools/list`, `tools/call`, `ping`); ~60 lines in `mcp/server.ts` beat adding `@modelcontextprotocol/sdk`
+ `zod` and lets tool schemas be plain JSON Schema.
