# src/render — Three.js layer

| File | What |
|---|---|
| `Viewport.ts` | Scene, lights, black bg, ghost cube, render-on-demand loop. Subscribes to `Editor` `voxels`/`palette` events and marks chunks dirty. `pick(grid, clientX, clientY)` → DDA `Hit`; `viewDirection()` → camera forward (used for the pen's plane lock); `toggleEdges()` → voxel outlines (`W`); `planeCell()` / `heightAt()` feed the box tool, `showBox(draft)` previews it; `toggleProjection()` and the `onViewChange` callbacks that let HUDs refresh. |
| `ChunkMesher.ts` | `buildChunkGeometry` (pure: exposed faces, vertex colors), `buildChunkEdgeGeometry` (pure: de-duplicated outlines of those faces) and `ChunkedVoxelMesh` (16³ chunks, numeric keys, lazy rebuild of dirty chunks incl. border neighbours; `setEdges` toggles the outline group and only builds it while on). |
| `GridLines.ts` | Floor + back wall (z=0) + left wall (x=0). Every cell, major every 16. Lines split into 16-unit pieces (SwiftShader near-plane bug). |
| `OrbitCamera.ts` | Spherical orbit (theta/phi/distance) around `target`; `rotate/pan/zoom/reset`. Holds a perspective **and** an orthographic camera in the same pose — `toggleProjection()` (`C`) swaps which one `camera` returns; the ortho frustum is derived from the perspective FOV at `distance`, so the view does not jump. |

Outlines are `LineSegments` in `voxels.edgeGroup`, drawn per exposed face and de-duplicated by corner
key; the solid material carries a `polygonOffset` so the fills sit a hair behind them and do not z-fight.

Color: palette hex is sRGB, but three treats vertex colors as linear working-space values, so
`ChunkMesher.srgbToLinear` converts them (skipping this made brown render as orange). Colors set from
strings via `THREE.Color` (ghost, box preview, grid) are converted by three itself. The light
intensities in `Viewport` sum to about PI on a sun-facing face — with Lambert's 1/PI that renders a
voxel at its palette color, with shaded sides around 60-75%. Raise them and channels clip and hues skew.

Conventions: world units = voxels; voxel (x,y,z) occupies [x,x+1)×[y,y+1)×[z,z+1). Call
`view.invalidate()` after any camera/scene change. Do not raycast Three meshes for picking — use the DDA.
