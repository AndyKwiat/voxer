import { describe, expect, test } from "bun:test";
import type { Hit } from "../src/core/Raycast";
import {
  planEdit, targetCell, applyEdit, revertEdit, dominantAxis, inPlane, makeBoxRegion, boxSize, planBoxEdits,
} from "../src/core/Tools";
import { VoxelGrid, EMPTY } from "../src/core/VoxelGrid";

const voxelHit: Hit = { cell: { x: 5, y: 5, z: 5 }, normal: { x: 0, y: 1, z: 0 }, voxel: true, t: 1 };
const floorHit: Hit = { cell: { x: 5, y: -1, z: 5 }, normal: { x: 0, y: 1, z: 0 }, voxel: false, t: 1 };
const wallHit: Hit = { cell: { x: 5, y: 3, z: -1 }, normal: { x: 0, y: 0, z: 1 }, voxel: false, t: 1 };

describe("targetCell", () => {
  test("pen places adjacent to hit face, including floor and walls", () => {
    const g = new VoxelGrid(16);
    expect(targetCell("pen", voxelHit, g)).toEqual({ x: 5, y: 6, z: 5 });
    expect(targetCell("pen", floorHit, g)).toEqual({ x: 5, y: 0, z: 5 });
    expect(targetCell("pen", wallHit, g)).toEqual({ x: 5, y: 3, z: 0 });
  });

  test("pen refuses to place outside the grid", () => {
    const g = new VoxelGrid(16);
    const top: Hit = { cell: { x: 0, y: 15, z: 0 }, normal: { x: 0, y: 1, z: 0 }, voxel: true, t: 1 };
    expect(targetCell("pen", top, g)).toBeNull();
  });

  test("eraser and paint target the hit voxel only", () => {
    const g = new VoxelGrid(16);
    expect(targetCell("eraser", voxelHit, g)).toEqual({ x: 5, y: 5, z: 5 });
    expect(targetCell("paint", voxelHit, g)).toEqual({ x: 5, y: 5, z: 5 });
    expect(targetCell("eraser", floorHit, g)).toBeNull();
    expect(targetCell("paint", floorHit, g)).toBeNull();
  });
});

describe("planEdit / applyEdit / revertEdit", () => {
  test("pen edit", () => {
    const g = new VoxelGrid(16);
    const e = planEdit("pen", floorHit, g, 3)!;
    expect(e).toEqual({ x: 5, y: 0, z: 5, before: EMPTY, after: 3 });
    applyEdit(g, e);
    expect(g.get(5, 0, 5)).toBe(3);
    revertEdit(g, e);
    expect(g.get(5, 0, 5)).toBe(EMPTY);
  });

  test("pen never overwrites an existing voxel", () => {
    const g = new VoxelGrid(16);
    g.set(5, 6, 5, 9);
    expect(planEdit("pen", voxelHit, g, 3)).toBeNull();
  });

  test("eraser and paint edits; no-op when nothing changes", () => {
    const g = new VoxelGrid(16);
    g.set(5, 5, 5, 2);
    expect(planEdit("paint", voxelHit, g, 2)).toBeNull();
    expect(planEdit("paint", voxelHit, g, 4)).toEqual({ x: 5, y: 5, z: 5, before: 2, after: 4 });
    expect(planEdit("eraser", voxelHit, g, 4)).toEqual({ x: 5, y: 5, z: 5, before: 2, after: EMPTY });
  });
});

describe("dominantAxis / inPlane", () => {
  test("picks the axis the camera looks most along", () => {
    expect(dominantAxis({ x: 0, y: -1, z: 0 })).toBe("y"); // top-down
    expect(dominantAxis({ x: 0.1, y: -0.2, z: -0.97 })).toBe("z"); // facing a z wall
    expect(dominantAxis({ x: -0.9, y: 0.1, z: 0.3 })).toBe("x");
    expect(dominantAxis({ x: 0.5, y: 0.5, z: 0.5 })).toBe("y"); // ties prefer the ground plane
    expect(dominantAxis({ x: 0.6, y: 0.1, z: 0.6 })).toBe("x"); // then x
  });

  test("inPlane compares only the locked axis", () => {
    const a = { x: 1, y: 2, z: 3 };
    expect(inPlane(a, { x: 9, y: 2, z: 9 }, "y")).toBe(true);
    expect(inPlane(a, { x: 9, y: 3, z: 9 }, "y")).toBe(false);
    expect(inPlane(a, { x: 1, y: 9, z: 9 }, "x")).toBe(true);
    expect(inPlane(a, { x: 9, y: 9, z: 3 }, "z")).toBe(true);
  });
});

describe("box regions", () => {
  test("normalizes corners and extrudes either way, clamped to the grid", () => {
    const a = { x: 5, y: 2, z: 7 }, b = { x: 1, y: 9, z: 3 }; // b.y is ignored
    expect(makeBoxRegion(a, b, 4, 32)).toEqual({ min: { x: 1, y: 2, z: 3 }, max: { x: 5, y: 4, z: 7 } });
    expect(makeBoxRegion(a, b, 0, 32)).toEqual({ min: { x: 1, y: 0, z: 3 }, max: { x: 5, y: 2, z: 7 } });
    expect(makeBoxRegion(a, { x: 99, y: 0, z: -4 }, 999, 32))
      .toEqual({ min: { x: 5, y: 2, z: 0 }, max: { x: 31, y: 31, z: 7 } });
    expect(boxSize(makeBoxRegion(a, b, 4, 32))).toEqual([5, 3, 5]);
  });

  test("a single cell is a 1x1x1 region", () => {
    const c = { x: 3, y: 3, z: 3 };
    expect(boxSize(makeBoxRegion(c, c, 3, 32))).toEqual([1, 1, 1]);
  });

  test("planBoxEdits fills only empty cells", () => {
    const g = new VoxelGrid(8);
    g.set(1, 0, 1, 9);
    const edits = planBoxEdits(g, { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, 3);
    expect(edits.length).toBe(7); // 8 cells minus the occupied one
    expect(edits.every((e) => e.before === EMPTY && e.after === 3)).toBe(true);
    expect(edits.some((e) => e.x === 1 && e.y === 0 && e.z === 1)).toBe(false);
  });

  test("box has no single-cell edit; targetCell still previews like the pen", () => {
    const g = new VoxelGrid(8);
    const hit = { cell: { x: 2, y: -1, z: 2 }, normal: { x: 0, y: 1, z: 0 }, voxel: false, t: 1 };
    expect(targetCell("box", hit, g)).toEqual({ x: 2, y: 0, z: 2 });
    expect(planEdit("box", hit, g, 1)).toBeNull();
  });
});
