# src/render — Three.js layer

| File | What |
|---|---|
| `Viewport.ts` | Scene, lights, black bg, ghost cube, render-on-demand loop. Subscribes to `Editor` `voxels`/`palette` events and marks chunks dirty. `pick(grid, clientX, clientY)` → DDA `Hit`; `viewDirection()` → camera forward (used for the pen's plane lock); `toggleEdges()` → voxel outlines (`W`). |
| `ChunkMesher.ts` | `buildChunkGeometry` (pure: exposed faces, vertex colors), `buildChunkEdgeGeometry` (pure: de-duplicated outlines of those faces) and `ChunkedVoxelMesh` (16³ chunks, numeric keys, lazy rebuild of dirty chunks incl. border neighbours; `setEdges` toggles the outline group and only builds it while on). |
| `GridLines.ts` | Floor + back wall (z=0) + left wall (x=0). Every cell, major every 16. Lines split into 16-unit pieces (SwiftShader near-plane bug). |
| `OrbitCamera.ts` | Spherical orbit (theta/phi/distance) around `target`; `rotate/pan/zoom/reset`. |

Outlines are `LineSegments` in `voxels.edgeGroup`, drawn per exposed face and de-duplicated by corner
key; the solid material carries a `polygonOffset` so the fills sit a hair behind them and do not z-fight.

Conventions: world units = voxels; voxel (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1). Call
`view.invalidate()` after any camera/scene change. Do not raycast Three meshes for picking — use the DDA.
