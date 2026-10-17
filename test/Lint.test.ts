import { describe, expect, test } from "bun:test";
import { planOps, type Op } from "../src/core/Commands";
import { lint } from "../src/core/Lint";
import { applyEdit } from "../src/core/Tools";
import { VoxelGrid } from "../src/core/VoxelGrid";

const resolve = (c: number | string) => (c as number) + 1;
function grid(size: number, ops: Op[]) {
  const g = new VoxelGrid(size);
  for (const e of planOps(g, ops, resolve)) applyEdit(g, e);
  return g;
}
const PAL = ["#ff0000", "#00ff00", "#0000ff", "#fe0201", "#808080"];

describe("lint", () => {
  test("empty scene", () => {
    const r = lint(new VoxelGrid(8), PAL);
    expect(r.count).toBe(0);
    expect(r.bbox).toBeNull();
    expect(r.components).toBeUndefined();
    expect(r.summary).toBe("empty scene");
    expect(r.palette!.unused).toEqual([0, 1, 2, 3, 4]);
  });

  test("connected components: count, sizes, bboxes (6-neighbour)", () => {
    const g = grid(16, [
      { op: "box", min: [0, 0, 0], max: [3, 1, 1], color: 0 },
      { op: "box", min: [8, 0, 8], max: [9, 2, 9], color: 1 },
      { op: "set", voxels: [[4, 2, 2, 0]] }, // only edge/corner contact with the first box: separate component
    ]);
    const c = lint(g, PAL, { connectivity: 6 }).components!;
    expect(c.count).toBe(3);
    expect(c.list.map((p) => p.size)).toEqual([16, 12, 1]);
    expect(c.list[0]!.bbox).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 1, z: 1 } });
    expect(c.list[1]!.bbox).toEqual({ min: { x: 8, y: 0, z: 8 }, max: { x: 9, y: 2, z: 9 } });
  });

  test("connectivity: default 26 joins edge/corner contact (diagonal lines stay one piece); 18 joins edges only", () => {
    const g = grid(16, [
      { op: "box", min: [0, 0, 0], max: [3, 1, 1], color: 0 },
      { op: "set", voxels: [[4, 2, 2, 0]] }, // corner contact with the box
      { op: "line", from: [8, 0, 8], to: [14, 6, 14], color: 1 }, // 3D diagonal: corner-to-corner steps
    ]);
    expect(lint(g, PAL).components!.count).toBe(2);
    expect(lint(g, PAL, { connectivity: 18 }).components!.count).toBe(1 + 1 + 7);
    expect(lint(g, PAL, { connectivity: 6 }).components!.count).toBe(1 + 1 + 7);
    expect(() => lint(g, PAL, { connectivity: 4 as never })).toThrow();
  });

  test("specks: small detached pieces with their cells", () => {
    const g = grid(16, [
      { op: "box", min: [0, 0, 0], max: [5, 5, 5], color: 0 },
      { op: "set", voxels: [[10, 0, 10, 0], [10, 0, 11, 0], [14, 7, 14, 1]] },
    ]);
    const r = lint(g, PAL);
    const c = r.components!;
    expect(c.speckCount).toBe(2);
    expect(c.specks).toContainEqual({ size: 2, cells: [{ x: 10, y: 0, z: 10 }, { x: 10, y: 0, z: 11 }] });
    expect(c.specks).toContainEqual({ size: 1, cells: [{ x: 14, y: 7, z: 14 }] });
    expect(lint(g, PAL, { speckSize: 2 }).components!.speckCount).toBe(1);
    expect(r.warnings.some((w) => w.startsWith("2 specks (< 4 voxels)"))).toBe(true);
  });

  test("floating: pieces not on the floor and not resting on a grounded piece", () => {
    const g = grid(16, [
      { op: "box", min: [0, 0, 0], max: [5, 5, 5], color: 0 }, // main body on the floor
      { op: "box", min: [6, 6, 0], max: [7, 7, 1], color: 1 }, // diagonally on top of the main body's corner edge
      { op: "box", min: [8, 8, 0], max: [8, 8, 1], color: 1 }, // diagonally on the previous piece
      { op: "box", min: [10, 10, 10], max: [12, 12, 12], color: 2 }, // in the air
    ]);
    const c = lint(g, PAL, { connectivity: 6 }).components!;
    expect(c.count).toBe(4);
    expect(c.mainOnFloor).toBe(true);
    expect(c.floatingCount).toBe(1);
    expect(c.floating[0]!.bbox).toEqual({ min: { x: 10, y: 10, z: 10 }, max: { x: 12, y: 12, z: 12 } });
    expect(c.list.filter((p) => p.grounded).length).toBe(3);
  });

  test("main body off the floor is reported, floorY moves the floor", () => {
    const g = grid(16, [{ op: "box", min: [2, 4, 2], max: [6, 8, 6], color: 0 }]);
    const r = lint(g, PAL);
    expect(r.components!.mainOnFloor).toBe(false);
    expect(r.components!.floatingCount).toBe(0); // the main body itself counts as support
    expect(r.warnings[0]).toBe("main body (125 voxels) does not reach the floor y=0 (min y 4)");
    expect(lint(g, PAL, { floorY: 4 }).components!.mainOnFloor).toBe(true);
  });

  test("enclosed air pockets", () => {
    const shell = grid(16, [{ op: "box", min: [1, 0, 1], max: [5, 4, 5], color: 0, hollow: true }]);
    expect(lint(shell, PAL).pockets).toEqual({ cells: 27, pockets: 1, bbox: { min: { x: 2, y: 1, z: 2 }, max: { x: 4, y: 3, z: 4 } } });
    const two = grid(16, [
      { op: "box", min: [1, 0, 1], max: [5, 4, 5], color: 0, hollow: true },
      { op: "box", min: [7, 0, 1], max: [9, 2, 3], color: 0, hollow: true },
    ]);
    expect(lint(two, PAL).pockets).toMatchObject({ cells: 28, pockets: 2 });
    const open = grid(16, [{ op: "box", min: [1, 0, 1], max: [5, 4, 5], color: 0, hollow: true }, { op: "set", voxels: [[3, 4, 3, null]] }]);
    expect(lint(open, PAL).pockets).toEqual({ cells: 0, pockets: 0, bbox: null });
    // a concave cup is open to the outside of its bbox
    const cup = grid(16, [{ op: "box", min: [0, 0, 0], max: [4, 3, 4], color: 0 }, { op: "box", min: [1, 1, 1], max: [3, 3, 3], erase: true }]);
    expect(lint(cup, PAL).pockets!.cells).toBe(0);
  });

  test("content touching the grid boundary (floor contact is normal)", () => {
    const floorOnly = lint(grid(8, [{ op: "box", min: [2, 0, 2], max: [4, 2, 4], color: 0 }]), PAL).boundary!;
    expect(floorOnly.touching).toBe(false);
    expect(floorOnly.faces["-y"]).toBe(9);
    const r = lint(grid(8, [{ op: "box", min: [5, 0, 2], max: [7, 2, 4], color: 0 }, { op: "set", voxels: [[3, 7, 0, 0]] }]), PAL);
    expect(r.boundary!.touching).toBe(true);
    expect(r.boundary!.faces).toEqual({ "-x": 0, "+x": 9, "-y": 9, "+y": 1, "-z": 1, "+z": 0 });
    expect(r.warnings).toContain("content touches the grid boundary (+x 9, +y 1, -z 1 voxels) — may be clipped");
  });

  test("mirror symmetry across x and z with the pivot used", () => {
    const sym = lint(grid(16, [{ op: "box", min: [3, 0, 2], max: [7, 2, 4], color: 0 }]), PAL).symmetry!;
    expect(sym.x).toEqual({ pivot: 10, shape: 1, color: 1 });
    expect(sym.z).toEqual({ pivot: 6, shape: 1, color: 1 });
    const g = grid(16, [
      { op: "box", min: [0, 0, 0], max: [3, 0, 0], color: 0 }, // x 0..3
      { op: "set", voxels: [[0, 1, 0, 1], [3, 1, 0, 2]] }, // same shape both sides, different colors
      { op: "set", voxels: [[0, 2, 0, 0]] }, // no partner at x=3
    ]);
    const s = lint(g, PAL).symmetry!;
    expect(s.x.pivot).toBe(3);
    expect(s.x.shape).toBe(Math.round((6 / 7) * 1000) / 1000);
    expect(s.x.color).toBe(Math.round((4 / 7) * 1000) / 1000);
    expect(s.z).toEqual({ pivot: 0, shape: 1, color: 1 });
  });

  test("palette: unused and near-duplicate used colors", () => {
    const g = grid(8, [{ op: "set", voxels: [[0, 0, 0, 0], [1, 0, 0, 3], [2, 0, 0, 4]] }]);
    const p = lint(g, PAL).palette!;
    expect(p.used).toBe(3);
    expect(p.unused).toEqual([1, 2]);
    expect(p.nearDuplicates).toEqual([{ a: 0, b: 3, hexA: "#ff0000", hexB: "#fe0201", distance: 2.4 }]);
    expect(lint(g, PAL, { nearColor: 1 }).palette!.nearDuplicates).toEqual([]);
  });

  test("options skip checks", () => {
    const r = lint(grid(8, [{ op: "box", min: [0, 0, 0], max: [1, 1, 1], color: 0 }]), PAL, { components: false, pockets: false, boundary: false, symmetry: false, palette: false });
    expect(r.components ?? r.pockets ?? r.boundary ?? r.symmetry ?? r.palette).toBeUndefined();
    expect(r.summary).toBe("8 voxels in 0,0,0..1,1,1");
  });

  test("fast on a 256³ grid with a large model", () => {
    const g = grid(256, [{ op: "ellipsoid", center: [128, 100, 128], radius: [100, 100, 100], color: 0, hollow: true }, { op: "box", min: [0, 0, 0], max: [255, 3, 255], color: 1 }]);
    const t = performance.now();
    const r = lint(g, PAL);
    const ms = performance.now() - t;
    expect(r.pockets!.pockets).toBe(1);
    expect(ms).toBeLessThan(5000);
    console.log(`lint 256³ (${r.count} voxels, bbox ${r.bbox!.max.y + 1} tall): ${Math.round(ms)} ms`);
  });
});
