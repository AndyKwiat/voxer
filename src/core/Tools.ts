import type { Hit, Vec3 } from "./Raycast";
import type { VoxelGrid } from "./VoxelGrid";
import { EMPTY } from "./VoxelGrid";

export type ToolName = "pen" | "eraser" | "paint";
export const TOOLS: readonly ToolName[] = ["pen", "eraser", "paint"];

export interface Edit {
  x: number;
  y: number;
  z: number;
  before: number;
  after: number;
}

/** Cell a tool would act on for a given hit, or null if none. */
export function targetCell(tool: ToolName, hit: Hit, grid: VoxelGrid): Vec3 | null {
  if (tool === "pen") {
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
