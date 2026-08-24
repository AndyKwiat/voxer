import { describe, expect, test } from "bun:test";
import { raycastGrid } from "../src/core/Raycast";
import { VoxelGrid } from "../src/core/VoxelGrid";

const norm = (x: number, y: number, z: number) => {
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
};

describe("raycastGrid", () => {
  test("hits a voxel along +x with -x normal", () => {
    const g = new VoxelGrid(16);
    g.set(5, 2, 2, 1);
    const h = raycastGrid(g, { x: -10, y: 2.5, z: 2.5 }, { x: 1, y: 0, z: 0 });
    expect(h).not.toBeNull();
    expect(h!.voxel).toBe(true);
    expect(h!.cell).toEqual({ x: 5, y: 2, z: 2 });
    expect(h!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  test("hits the top face of a voxel from above", () => {
    const g = new VoxelGrid(16);
    g.set(3, 0, 3, 1);
    const h = raycastGrid(g, { x: 3.5, y: 20, z: 3.5 }, { x: 0, y: -1, z: 0 });
    expect(h!.cell).toEqual({ x: 3, y: 0, z: 3 });
    expect(h!.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  test("returns the first voxel along a diagonal", () => {
    const g = new VoxelGrid(16);
    g.set(8, 8, 8, 1);
    g.set(4, 4, 4, 2);
    const h = raycastGrid(g, { x: 0.5, y: 0.5, z: 0.5 }, norm(1, 1, 1));
    expect(h!.cell).toEqual({ x: 4, y: 4, z: 4 });
  });

  test("hits the floor plane when no voxel is present", () => {
    const g = new VoxelGrid(16);
    const h = raycastGrid(g, { x: 8.5, y: 30, z: 8.5 }, norm(0, -1, 0.001));
    expect(h!.voxel).toBe(false);
    expect(h!.cell.y).toBe(-1);
    expect(h!.cell.x).toBe(8);
    expect(h!.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  test("hits the back wall (z=-1) and left wall (x=-1)", () => {
    const g = new VoxelGrid(16);
    const back = raycastGrid(g, { x: 4.5, y: 4.5, z: 30 }, { x: 0, y: 0, z: -1 });
    expect(back).toEqual({ cell: { x: 4, y: 4, z: -1 }, normal: { x: 0, y: 0, z: 1 }, voxel: false, t: expect.any(Number) });
    const left = raycastGrid(g, { x: 30, y: 4.5, z: 4.5 }, { x: -1, y: 0, z: 0 });
    expect(left!.cell).toEqual({ x: -1, y: 4, z: 4 });
    expect(left!.normal).toEqual({ x: 1, y: 0, z: 0 });
  });

  test("ray exiting through +y/+x/+z hits nothing; ray missing the box hits nothing", () => {
    const g = new VoxelGrid(16);
    expect(raycastGrid(g, { x: 4.5, y: 4.5, z: 4.5 }, { x: 0, y: 1, z: 0 })).toBeNull();
    expect(raycastGrid(g, { x: -5, y: 50, z: 5 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(raycastGrid(g, { x: -5, y: 5, z: 5 }, { x: -1, y: 0, z: 0 })).toBeNull();
  });

  test("ray starting inside the grid hits the voxel in front of it", () => {
    const g = new VoxelGrid(16);
    g.set(10, 5, 5, 1);
    const h = raycastGrid(g, { x: 2.5, y: 5.5, z: 5.5 }, { x: 1, y: 0, z: 0 });
    expect(h!.cell).toEqual({ x: 10, y: 5, z: 5 });
    expect(h!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });
});
