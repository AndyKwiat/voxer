import type { VoxelGrid } from "./VoxelGrid";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Hit {
  /** Cell that was hit (a voxel, or a boundary cell just outside the grid for floor/walls). */
  cell: Vec3;
  /** Unit normal of the face hit, pointing toward the ray origin. */
  normal: Vec3;
  /** Whether a voxel was hit (true) or a boundary plane (false). */
  voxel: boolean;
  t: number;
}

const EPS = 1e-9;

/**
 * Amanatides-Woo DDA through the grid. Returns the first occupied voxel, or the
 * floor (y=-1 cell) / back wall (z=-1) / left wall (x=-1) boundary plane if the ray
 * exits the grid through one of them. Returns null if nothing is hit.
 */
export function raycastGrid(grid: VoxelGrid, origin: Vec3, dir: Vec3, maxDist = 4096): Hit | null {
  const s = grid.size;
  // Clip ray to the grid's bounding box.
  let tmin = 0;
  let tmax = maxDist;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < EPS) {
      if (o[a]! < 0 || o[a]! >= s) return null;
    } else {
      let t1 = (0 - o[a]!) / d[a]!;
      let t2 = (s - o[a]!) / d[a]!;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  const t0 = tmin + 1e-6;
  const px = origin.x + dir.x * t0;
  const py = origin.y + dir.y * t0;
  const pz = origin.z + dir.z * t0;
  let x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
  x = Math.min(Math.max(x, 0), s - 1);
  y = Math.min(Math.max(y, 0), s - 1);
  z = Math.min(Math.max(z, 0), s - 1);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
  const tDeltaX = stepX ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = stepX ? ((stepX > 0 ? x + 1 : x) - origin.x) / dir.x : Infinity;
  let tMaxY = stepY ? ((stepY > 0 ? y + 1 : y) - origin.y) / dir.y : Infinity;
  let tMaxZ = stepZ ? ((stepZ > 0 ? z + 1 : z) - origin.z) / dir.z : Infinity;

  // Normal of the face through which we entered the current cell.
  let nx = 0, ny = 0, nz = 0;
  if (tmin > 0) {
    // Entered from outside: determine which slab produced tmin.
    const tx = stepX ? (stepX > 0 ? (0 - origin.x) / dir.x : (s - origin.x) / dir.x) : -Infinity;
    const ty = stepY ? (stepY > 0 ? (0 - origin.y) / dir.y : (s - origin.y) / dir.y) : -Infinity;
    const tz = stepZ ? (stepZ > 0 ? (0 - origin.z) / dir.z : (s - origin.z) / dir.z) : -Infinity;
    if (tx >= ty && tx >= tz) nx = -stepX;
    else if (ty >= tz) ny = -stepY;
    else nz = -stepZ;
  }

  let t = tmin;
  while (t <= tmax) {
    if (grid.has(x, y, z)) {
      return { cell: { x, y, z }, normal: { x: nx, y: ny, z: nz }, voxel: true, t };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX; x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY; y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    if (x < 0 || y < 0 || z < 0 || x >= s || y >= s || z >= s) break;
  }
  // Exited the grid. Floor / walls are the planes at x=0, y=0, z=0 — hit if we left through them.
  if (y < 0) return { cell: { x, y: -1, z }, normal: { x: 0, y: 1, z: 0 }, voxel: false, t };
  if (z < 0) return { cell: { x, y, z: -1 }, normal: { x: 0, y: 0, z: 1 }, voxel: false, t };
  if (x < 0) return { cell: { x: -1, y, z }, normal: { x: 1, y: 0, z: 0 }, voxel: false, t };
  return null;
}
