# src/render — Three.js layer

| File | What |
|---|---|
| `Viewport.ts` | Scene, lights, black bg, ghost cube, render-on-demand loop. Subscribes to `Editor` `voxels`/`palette` events and marks chunks dirty. `pick(grid, clientX, clientY)` → DDA `Hit`; `viewDirection()` → camera forward (used for the pen's plane lock). |
| `ChunkMesher.ts` | `buildChunkGeometry` (pure: exposed faces, vertex colors) and `ChunkedVoxelMesh` (16³ chunks, numeric keys, lazy rebuild of dirty chunks incl. border neighbours). |
| `GridLines.ts` | Floor + back wall (z=0) + left wall (x=0). Every cell, major every 16. Lines split into 16-unit pieces (SwiftShader near-plane bug). |
| `OrbitCamera.ts` | Spherical orbit (theta/phi/distance) around `target`; `rotate/pan/zoom/reset/lookFrom`. Default framing scales with `gridSize`. |
| `Views.ts` | Pure: named views (`front` = camera at +Z … `top` with -Z up, `iso*`), square ortho framing, ruler step, iso camera fit. |
| `Capture.ts` | `snapshotSheet(view, editor, opts)` → labeled contact-sheet canvas (ortho tiles: flat colors over a 2D cell grid with coordinate rulers; iso tiles: lit perspective; optional reference tile; optional scale figure). |
| `ScaleFigure.ts` | Snapshot-only scale person (`opts.figure`: `true` = 8 cells, or a height): pure `figureSpec` places it on y=0 one cell off the content's front-left corner (flips to +x / -z when the grid has no room), `withFigure` adds it to the scene only while tiles render. |

Conventions: world units = voxels; voxel (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1). Call
`view.invalidate()` after any camera/scene change. On the editor's `reset` event `Viewport` rebuilds
grid lines + meshes. `renderOffscreen(camera, px, {grid, transparent, flat})` renders one frame with
another camera and restores the live frame in the same task (renderer has `alpha: true` for this). Do not raycast Three meshes for picking — use the DDA.
