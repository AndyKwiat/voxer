import { describe, expect, test } from "bun:test";
import { VoxelGrid, EMPTY } from "../src/core/VoxelGrid";

describe("VoxelGrid", () => {
  test("starts empty with the right size", () => {
    const g = new VoxelGrid(8);
    expect(g.size).toBe(8);
    expect(g.count).toBe(0);
    expect(g.data.length).toBe(512);
    expect(new VoxelGrid().size).toBe(32);
  });

  test("set / get / erase and count", () => {
    const g = new VoxelGrid(8);
    expect(g.set(1, 2, 3, 5)).toBe(EMPTY);
    expect(g.get(1, 2, 3)).toBe(5);
    expect(g.has(1, 2, 3)).toBe(true);
    expect(g.count).toBe(1);
    expect(g.set(1, 2, 3, 7)).toBe(5);
    expect(g.count).toBe(1);
    expect(g.erase(1, 2, 3)).toBe(7);
    expect(g.count).toBe(0);
    expect(g.has(1, 2, 3)).toBe(false);
  });

  test("distinct cells map to distinct indices", () => {
    const g = new VoxelGrid(4);
    const seen = new Set<number>();
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) seen.add(g.index(x, y, z));
    expect(seen.size).toBe(64);
  });

  test("out of bounds get returns EMPTY, set throws", () => {
    const g = new VoxelGrid(4);
    expect(g.get(-1, 0, 0)).toBe(EMPTY);
    expect(g.get(0, 4, 0)).toBe(EMPTY);
    expect(() => g.set(4, 0, 0, 1)).toThrow(RangeError);
    expect(() => g.set(0, 0, 0, 256)).toThrow(RangeError);
    expect(() => new VoxelGrid(0)).toThrow();
    expect(() => new VoxelGrid(257)).toThrow();
  });

  test("occupied iterates only set voxels", () => {
    const g = new VoxelGrid(4);
    g.set(0, 0, 0, 1);
    g.set(3, 3, 3, 2);
    expect([...g.occupied()]).toEqual([
      { x: 0, y: 0, z: 0, value: 1 },
      { x: 3, y: 3, z: 3, value: 2 },
    ]);
  });
});
