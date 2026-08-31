# src/render — Three.js layer

| File | What |
|---|---|
| `Viewport.ts` | Scene, lights, black bg, ghost cube, render-on-demand loop. Subscribes to `Editor` `voxels`/`palette` events and marks chunks dirty. `pick(grid, clientX, clientY)` → DDA `Hit`; `viewDirection()` → camera forward (used for the pen's plane lock). |
| `ChunkMesher.ts` | `buildChunkGeometry` (pure: exposed faces, vertex colors) and `ChunkedVoxelMesh` (16³ chunks, numeric keys, lazy rebuild of dirty chunks incl. border neighbours). |
| `GridLines.ts` | Floor + back wall (z=0) + left wall (x=0). Every cell, major every 16. Lines split into 16-unit pieces (SwiftShader near-plane bug). |
| `OrbitCamera.ts` | Spherical orbit (theta/phi/distance) around `target`; `rotate/pan/zoom/reset`. |

Conventions: world units = voxels; voxel (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1). Call
`view.invalidate()` after any camera/scene change. Do not raycast Three meshes for picking — use the DDA.
