import type { Hit, Vec3 } from "./Raycast";
import type { VoxelGrid } from "./VoxelGrid";
import { EMPTY } from "./VoxelGrid";

export type ToolName = "pen" | "eraser" | "paint" | "box";
export const TOOLS: readonly ToolName[] = ["pen", "eraser", "paint", "box"];

export interface Edit {
  x: number;
  y: number;
  z: number;
  before: number;
  after: number;
}

/** Cell a tool would act on for a given hit, or null if none. */
export function targetCell(tool: ToolName, hit: Hit, grid: VoxelGrid): Vec3 | null {
  if (tool === "pen" || tool === "box") {
    const c = { x: hit.cell.x + hit.normal.x, y: hit.cell.y + hit.normal.y, z: hit.cell.z + hit.normal.z };
    return grid.inBounds(c.x, c.y, c.z) ? c : null;
  }
  return hit.voxel ? hit.cell : null;
}

/** Computes (without applying) the edit a tool would make. */
export function planEdit(tool: ToolName, hit: Hit, grid: VoxelGrid, cellValue: number): Edit | null {
  const c = targetCell(tool, hit, grid);
  if (!c) return null;
  const before = grid.get(c.x, c.y, c.z);
  let after: number;
  switch (tool) {
    case "box":
      return null; // multi-step: see Editor.beginBox / commitBox
    case "pen":
      if (before !== EMPTY) return null;
      after = cellValue;
      break;
    case "eraser":
      after = EMPTY;
      break;
    case "paint":
      after = cellValue;
      break;
  }
  if (after === before) return null;
  return { ...c, before, after };
}

export function applyEdit(grid: VoxelGrid, e: Edit): void {
  grid.set(e.x, e.y, e.z, e.after);
}

export function revertEdit(grid: VoxelGrid, e: Edit): void {
  grid.set(e.x, e.y, e.z, e.before);
}

export type Axis = "x" | "y" | "z";

/**
 * Axis normal to the plane a viewer looking along `dir` sees most face-on — the largest
 * component of the view direction. Looking top-down (`dir ≈ 0,-1,0`) gives `"y"`, i.e. the
 * horizontal x-z plane. Ties prefer y, then x.
 */
export function dominantAxis(dir: Vec3): Axis {
  const ax = Math.abs(dir.x), ay = Math.abs(dir.y), az = Math.abs(dir.z);
  if (ay >= ax && ay >= az) return "y";
  return ax >= az ? "x" : "z";
}

/** True if `c` is in the `axis`-normal plane through `anchor`. */
export function inPlane(anchor: Vec3, c: Vec3, axis: Axis): boolean {
  return c[axis] === anchor[axis];
}

/** Inclusive cell range of a box. */
export interface BoxRegion {
  min: Vec3;
  max: Vec3;
}

const clamp = (n: number, hi: number) => Math.max(0, Math.min(hi, n));

/**
 * The box spanned by two corners on one horizontal plane, extruded to `topY` (either direction).
 * Everything is clamped into the grid, so a drag off the edge still yields a usable region.
 */
export function makeBoxRegion(a: Vec3, b: Vec3, topY: number, size: number): BoxRegion {
  const hi = size - 1;
  const ys = [clamp(a.y, hi), clamp(topY, hi)];
  return {
    min: { x: clamp(Math.min(a.x, b.x), hi), y: Math.min(ys[0]!, ys[1]!), z: clamp(Math.min(a.z, b.z), hi) },
    max: { x: clamp(Math.max(a.x, b.x), hi), y: Math.max(ys[0]!, ys[1]!), z: clamp(Math.max(a.z, b.z), hi) },
  };
}

/** Cell counts of a region, as [width, height, depth]. */
export function boxSize(r: BoxRegion): [number, number, number] {
  return [r.max.x - r.min.x + 1, r.max.y - r.min.y + 1, r.max.z - r.min.z + 1];
}

/** Fills the region's empty cells. Like the pen, it never overwrites existing voxels. */
export function planBoxEdits(grid: VoxelGrid, r: BoxRegion, cellValue: number): Edit[] {
  const edits: Edit[] = [];
  for (let y = r.min.y; y <= r.max.y; y++)
    for (let z = r.min.z; z <= r.max.z; z++)
      for (let x = r.min.x; x <= r.max.x; x++) {
        if (!grid.inBounds(x, y, z) || grid.get(x, y, z) !== EMPTY) continue;
        edits.push({ x, y, z, before: EMPTY, after: cellValue });
      }
  return edits;
}
