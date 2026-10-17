import { describe, expect, test } from "bun:test";
import { boundingBox, dumpLayer, layerCell, planOps, type Op } from "../src/core/Commands";
import { applyEdit } from "../src/core/Tools";
import { VoxelGrid } from "../src/core/VoxelGrid";

/** Resolver for tests: numbers are palette indices, "#rrggbb" maps to fixed indices. */
const HEX: Record<string, number> = { "#ff0000": 6, "#00ff00": 10 };
const resolve = (c: number | string) => (typeof c === "number" ? c : HEX[c]!) + 1;

function run(grid: VoxelGrid, ops: Op[]) {
  const edits = planOps(grid, ops, resolve);
  for (const e of edits) applyEdit(grid, e);
  return edits;
}

describe("Commands", () => {
  test("box: solid, hollow, erase, clipped to grid", () => {
    const g = new VoxelGrid(8);
    run(g, [{ op: "box", min: [0, 0, 0], max: [2, 2, 2], color: 1 }]);
    expect(g.count).toBe(27);
    expect(g.get(1, 1, 1)).toBe(2);
    run(g, [{ op: "box", min: [1, 1, 1], max: [1, 1, 1], erase: true }]);
    expect(g.count).toBe(26);
    const h = new VoxelGrid(8);
    run(h, [{ op: "box", min: [3, 3, 3], max: [0, 0, 0], color: "#ff0000", hollow: true }]); // min/max order free
    expect(h.count).toBe(64 - 8);
    expect(h.get(0, 0, 0)).toBe(7);
    const c = new VoxelGrid(4);
    run(c, [{ op: "box", min: [-5, 2, 2], max: [10, 2, 2], color: 0 }]);
    expect(c.count).toBe(4);
  });

  test("box needs a color or erase", () => {
    expect(() => planOps(new VoxelGrid(4), [{ op: "box", min: [0, 0, 0], max: [1, 1, 1] }], resolve)).toThrow(/op 0 \(box\)/);
  });

  test("ellipsoid / sphere diameter is 2r+1 along each axis", () => {
    const g = new VoxelGrid(16);
    run(g, [{ op: "ellipsoid", center: [8, 8, 8], radius: 3, color: 0 }]);
    expect(boundingBox(g)).toEqual({ min: { x: 5, y: 5, z: 5 }, max: { x: 11, y: 11, z: 11 } });
    const solid = g.count;
    const h = new VoxelGrid(16);
    run(h, [{ op: "ellipsoid", center: [8, 8, 8], radius: [4, 2, 1], color: 0, hollow: true }]);
    expect(boundingBox(h)).toEqual({ min: { x: 4, y: 6, z: 7 }, max: { x: 12, y: 10, z: 9 } });
    const k = new VoxelGrid(16);
    run(k, [{ op: "ellipsoid", center: [8, 8, 8], radius: 3, color: 0, hollow: true }]);
    expect(k.count).toBeLessThan(solid);
    expect(k.has(8, 8, 8)).toBe(false);
  });

  test("cylinder along y and x", () => {
    const g = new VoxelGrid(16);
    run(g, [{ op: "cylinder", base: [8, 0, 8], radius: 2, height: 5, color: 0 }]);
    expect(boundingBox(g)).toEqual({ min: { x: 6, y: 0, z: 6 }, max: { x: 10, y: 4, z: 10 } });
    const h = new VoxelGrid(16);
    run(h, [{ op: "cylinder", base: [2, 8, 8], radius: 1, height: 4, axis: "x", color: 0 }]);
    expect(boundingBox(h)).toEqual({ min: { x: 2, y: 7, z: 7 }, max: { x: 5, y: 9, z: 9 } });
  });

  test("line covers both endpoints; radius thickens it", () => {
    const g = new VoxelGrid(16);
    run(g, [{ op: "line", from: [0, 0, 0], to: [5, 2, 0], color: 0 }]);
    expect(g.count).toBe(6);
    expect(g.has(0, 0, 0) && g.has(5, 2, 0)).toBe(true);
    const h = new VoxelGrid(16);
    run(h, [{ op: "line", from: [4, 4, 4], to: [8, 4, 4], color: 0, radius: 1 }]);
    expect(h.has(6, 5, 4) && h.has(6, 4, 5)).toBe(true);
  });

  test("layer layouts match the snapshot views", () => {
    expect(layerCell("y", 3, 0, 0, 0, 0, 2)).toEqual({ x: 0, y: 3, z: 0 }); // top view: row 0 = back
    expect(layerCell("z", 3, 0, 0, 0, 0, 2)).toEqual({ x: 0, y: 1, z: 3 }); // front view: row 0 = top
    expect(layerCell("x", 3, 1, 0, 1, 2, 2)).toEqual({ x: 3, y: 0, z: 3 });
  });

  test("layer paints with a legend, skips . and space, can clear, rejects unknown chars", () => {
    const g = new VoxelGrid(8);
    run(g, [{ op: "layer", axis: "z", index: 2, offset: [1, 0], legend: { r: "#ff0000", g: 3 }, rows: ["r.r", " g "] }]);
    expect(g.count).toBe(3);
    expect(g.get(1, 1, 2)).toBe(7); // top row at y=1
    expect(g.get(2, 0, 2)).toBe(4);
    run(g, [{ op: "layer", axis: "z", index: 2, offset: [1, 0], legend: { x: null }, rows: ["x..", "..."], clear: true }]);
    expect(g.count).toBe(0);
    expect(() => planOps(g, [{ op: "layer", axis: "y", index: 0, legend: {}, rows: ["q"] }], resolve)).toThrow(/"q"/);
  });

  test("dumpLayer round-trips through layer", () => {
    const g = new VoxelGrid(6);
    run(g, [{ op: "box", min: [1, 0, 2], max: [3, 2, 2], color: 0 }, { op: "set", voxels: [[2, 1, 2, 5]] }]);
    const d = dumpLayer(g, "z", 2, (v) => `#c${v}`);
    expect(d.rows.length).toBe(6);
    expect(d.rows[3]).toBe(".aaa..");
    expect(d.rows[4]).toBe(".aba..");
    expect(d.legend).toEqual({ a: "#c1", b: "#c6" });
    const h = new VoxelGrid(6);
    const back: Record<string, number> = { a: 0, b: 5 };
    run(h, [{ op: "layer", axis: "z", index: 2, offset: d.offset, rows: d.rows, legend: back }]);
    expect(h.data).toEqual(g.data);
  });

  test("mirror copies the lower half across the pivot", () => {
    const g = new VoxelGrid(8);
    run(g, [{ op: "set", voxels: [[0, 0, 0, 1], [2, 1, 3, 2], [6, 0, 0, 3]] }, { op: "mirror", axis: "x" }]);
    expect(g.get(7, 0, 0)).toBe(2);
    expect(g.get(5, 1, 3)).toBe(3);
    expect(g.get(1, 0, 0)).toBe(0); // upper-half voxel not copied back
    const h = new VoxelGrid(9);
    run(h, [{ op: "set", voxels: [[3, 0, 0, 1]] }, { op: "mirror", axis: "x", pivot: 8 }]); // centered on cell 4
    expect(h.get(5, 0, 0)).toBe(2);
  });

  test("translate moves or copies a region; later ops in a batch see earlier ones", () => {
    const g = new VoxelGrid(8);
    run(g, [{ op: "box", min: [0, 0, 0], max: [1, 0, 0], color: 0 }, { op: "translate", offset: [3, 1, 0] }]);
    expect(g.has(0, 0, 0)).toBe(false);
    expect(g.has(3, 1, 0) && g.has(4, 1, 0)).toBe(true);
    run(g, [{ op: "translate", offset: [0, 0, 2], min: [3, 1, 0], max: [3, 1, 0], copy: true }]);
    expect(g.has(3, 1, 0) && g.has(3, 1, 2)).toBe(true);
    expect(g.count).toBe(3);
  });

  test("replace_color and clear", () => {
    const g = new VoxelGrid(4);
    run(g, [{ op: "box", min: [0, 0, 0], max: [3, 0, 0], color: 1 }, { op: "set", voxels: [{ x: 0, y: 1, z: 0, color: 2 }] }]);
    run(g, [{ op: "replace_color", from: 1, to: "#00ff00" }]);
    expect(g.get(2, 0, 0)).toBe(11);
    expect(g.get(0, 1, 0)).toBe(3);
    run(g, [{ op: "replace_color", from: 2, to: null }]);
    expect(g.count).toBe(4);
    run(g, [{ op: "clear" }]);
    expect(g.count).toBe(0);
  });

  test("unchanged cells produce no edits", () => {
    const g = new VoxelGrid(4);
    run(g, [{ op: "box", min: [0, 0, 0], max: [1, 1, 1], color: 0 }]);
    expect(planOps(g, [{ op: "box", min: [0, 0, 0], max: [1, 1, 1], color: 0 }], resolve)).toEqual([]);
    expect(() => planOps(g, [{ op: "nope" } as unknown as Op], resolve)).toThrow(/unknown op/);
  });
});
