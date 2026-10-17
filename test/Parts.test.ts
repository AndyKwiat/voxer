import { describe, expect, test } from "bun:test";
import { boundingBox, type Op } from "../src/core/Commands";
import { Editor } from "../src/core/Editor";
import { hash3, MATERIALS, roofLayout, shade, stampCells } from "../src/core/Parts";
import { VoxelGrid } from "../src/core/VoxelGrid";

const ed = (size = 48) => { const e = new Editor(new VoxelGrid(size)); return e; };
/** Hex color at a cell, or null if empty. */
const hexAt = (e: Editor, x: number, y: number, z: number) => { const v = e.grid.get(x, y, z); return v ? e.palette.get(v - 1)! : null; };
const cellsOf = (e: Editor, hex: string) => [...e.grid.occupied()].filter((p) => e.palette.get(p.value - 1) === hex);
const snapshot = (e: Editor) => Array.from(e.grid.data).join(",");

describe("Parts: roof", () => {
  const op: Op = { op: "roof", min: [10, 10], max: [30, 22], y: 5 };

  test("footprint = min/max + eave (+1 for upturned corners); ridge at y + layers", () => {
    const e = ed();
    e.run([{ ...op, corners: "flat", ridge: false }]);
    expect(boundingBox(e.grid)).toEqual({ min: { x: 8, y: 5, z: 8 }, max: { x: 32, y: 10, z: 24 } }); // 6 layers
    const L = roofLayout(op as never);
    expect(L.layers.map((l) => [l.v0, l.v1])).toEqual([[8, 24], [10, 22], [12, 20], [13, 19], [14, 18], [15, 17]]);
    expect(L.ridgeY).toBe(5 + L.layers.length);
    const f = ed();
    f.run([op]);
    const bb = boundingBox(f.grid)!;
    expect(bb.min).toEqual({ x: 7, y: 5, z: 7 }); // upturned corner tips
    expect(bb.max.y).toBe(L.ridgeY! + 2); // ridge end curls
    expect(hexAt(f, 20, L.ridgeY!, 16)).toBe(shade(MATERIALS.roof, 0.45));
  });

  test("shade ramp from base color (hex and palette index give the same shades)", () => {
    const a = ed(), b = ed();
    a.run([{ ...op, color: "#808080" }]);
    const idx = b.palette.resolve("#808080");
    b.run([{ ...op, color: idx }]);
    expect(snapshot(a)).toBe(snapshot(b));
    for (const f of [0.74, 1.22, 1.42, 0.45, 0.86]) expect(cellsOf(a, shade("#808080", f)).length).toBeGreaterThan(0);
    const c = ed();
    c.run([{ ...op, ramp: { ridge: "#ff0000" } }]);
    expect(cellsOf(c, "#ff0000").length).toBeGreaterThan(10);
  });

  test("maxLayers / steps / gable / axis / pearl", () => {
    const e = ed();
    e.run([{ op: "roof", min: [10, 10], max: [30, 22], y: 5, maxLayers: 2, ridge: false, corners: "flat" }]);
    expect(boundingBox(e.grid)!.max.y).toBe(6);
    expect(roofLayout({ op: "roof", min: [0, 0], max: [20, 10], y: 0, eave: 0, steps: [1, 1, 1] }).layers.length).toBe(5);
    const g = ed();
    g.run([{ op: "roof", min: [10, 10], max: [30, 22], y: 5, style: "gable", corners: "flat", ridge: false }]);
    for (const l of roofLayout({ op: "roof", min: [10, 10], max: [30, 22], y: 5, style: "gable" }).layers) expect([l.u0, l.u1]).toEqual([8, 32]);
    expect(cellsOf(g, shade(MATERIALS.roof, 0.86)).length).toBe(0); // no hip ends
    expect(roofLayout({ op: "roof", min: [10, 0], max: [14, 30], y: 0 }).axis).toBe("z");
    const p = ed();
    p.run([{ ...op, pearl: true }]);
    expect(cellsOf(p, MATERIALS.gold).length).toBe(2);
  });

  test("deterministic and clipped", () => {
    const a = ed(), b = ed();
    a.run([op]); b.run([op]);
    expect(snapshot(a)).toBe(snapshot(b));
    const c = ed(16);
    expect(() => c.run([{ op: "roof", min: [-10, -10], max: [40, 40], y: 10 }])).not.toThrow();
    expect(c.grid.count).toBeGreaterThan(0);
  });
});

describe("Parts: walls", () => {
  test("shell, interior empty, top shadow, skirt, posts, floor", () => {
    const e = ed(32);
    e.run([{ op: "walls", min: [2, 1, 2], max: [11, 6, 9], skirt: true, posts: true, floor: "#555555" }]);
    // perimeter 10x8 -> 2*10 + 2*6 = 32 cells per row, 6 rows, + 8x6 floor
    expect(e.grid.count).toBe(32 * 6 + 8 * 6);
    expect(e.grid.get(5, 3, 5)).toBe(0);
    expect(hexAt(e, 5, 1, 5)).toBe("#555555");
    expect(hexAt(e, 2, 3, 2)).toBe(MATERIALS.pillar);
    expect(hexAt(e, 11, 6, 9)).toBe(shade(MATERIALS.pillar, 0.74));
    expect<string[]>([MATERIALS.skirt, MATERIALS.skirtD]).toContain(hexAt(e, 5, 2, 2)!);
    expect(hexAt(e, 5, 6, 2)).toBe(shade(MATERIALS.plaster, 0.72));
    const plaster = [MATERIALS.plaster, shade(MATERIALS.plaster, 0.93), shade(MATERIALS.plaster, 1.04)];
    expect(plaster).toContain(hexAt(e, 5, 4, 2)!);
  });

  test("mottle is deterministic per seed; mottle 0 is flat; pattern overrides", () => {
    const w: Op = { op: "walls", min: [0, 0, 0], max: [20, 10, 20], top: false };
    const a = ed(), b = ed(), c = ed();
    a.run([w]); b.run([w]); c.run([{ ...w, seed: 9 }]);
    expect(snapshot(a)).toBe(snapshot(b));
    expect(snapshot(a)).not.toBe(snapshot(c));
    const f = ed();
    f.run([{ ...w, mottle: 0 }]);
    expect(cellsOf(f, MATERIALS.plaster).length).toBe(f.grid.count);
    const p = ed();
    p.run([{ ...w, pattern: "stripes", colors: ["#111111", "#222222"] }]);
    expect(hexAt(p, 0, 0, 5)).toBe("#111111");
    expect(hexAt(p, 0, 1, 5)).toBe("#222222");
  });
});

describe("Parts: openings", () => {
  test("window: hole on the face, pane recessed 1, frame + sill", () => {
    const e = ed(32);
    e.run([{ op: "box", min: [0, 0, 0], max: [20, 12, 10], color: "#ffffff" }, { op: "window", at: [4, 3, 10], size: [4, 5], style: "plain" }]);
    for (let x = 4; x < 8; x++) for (let y = 3; y < 8; y++) { expect(e.grid.get(x, y, 10)).toBe(0); expect(hexAt(e, x, y, 9)).toBe(MATERIALS.paper); }
    expect(hexAt(e, 3, 5, 10)).toBe(MATERIALS.wood);
    expect(hexAt(e, 5, 2, 10)).toBe(MATERIALS.woodL);
    expect(hexAt(e, 5, 2, 11)).toBe(MATERIALS.woodL); // sill sticks out
    expect(e.grid.get(5, 3, 11)).toBe(0);
  });

  test("window on -x face recesses toward +x; lattice/slats/round", () => {
    const e = ed(32);
    e.run([{ op: "window", at: [5, 3, 10], face: "-x", size: [4, 4], style: "slats" }]);
    expect(hexAt(e, 6, 3, 10)).toBe(MATERIALS.lattice);
    expect(hexAt(e, 6, 3, 11)).toBe(MATERIALS.paper);
    expect(hexAt(e, 4, 2, 10)).toBe(MATERIALS.woodL); // sill outside (-x)
    const r = ed(32);
    r.run([{ op: "window", at: [5, 5, 10], size: [5, 5], style: "round" }]);
    expect(r.grid.get(5, 5, 9)).toBe(0); // corners of the square are not part of a round pane
    expect(r.grid.get(7, 7, 9)).not.toBe(0);
  });

  test("door: recessed leaves with seam, posts, lintel, plaque", () => {
    const e = ed(32);
    e.run([{ op: "box", min: [0, 0, 0], max: [20, 14, 10], color: "#ffffff" }, { op: "door", at: [8, 1, 10], plaque: true }]);
    for (let y = 1; y < 10; y++) expect(e.grid.get(9, y, 10)).toBe(0);
    expect(hexAt(e, 9, 3, 9)).toBe(MATERIALS.doorD);
    expect(hexAt(e, 10, 3, 9)).toBe(MATERIALS.door);
    expect(hexAt(e, 8, 2, 9)).toBe(MATERIALS.gold);
    expect(hexAt(e, 7, 3, 10)).toBe(MATERIALS.red);
    expect(hexAt(e, 9, 10, 10)).toBe(MATERIALS.woodD);
    expect([8, 9, 10, 11].map((x) => hexAt(e, x, 11, 11))).toEqual([MATERIALS.plaque, MATERIALS.gold, MATERIALS.gold, MATERIALS.plaque]);
  });

  test("arch carves straight sides and a round crown", () => {
    const e = ed(32);
    e.run([{ op: "box", min: [0, 0, 0], max: [20, 20, 5], color: "#ffffff" }, { op: "arch", min: [5, 0, 0], max: [14, 12, 5] }]);
    for (let y = 0; y <= 7; y++) { expect(e.grid.get(5, y, 2)).toBe(0); expect(e.grid.get(14, y, 2)).toBe(0); }
    expect(e.grid.get(5, 12, 2)).not.toBe(0); // crown corners stay
    expect(e.grid.get(9, 12, 2)).toBe(0);
    expect(e.grid.get(10, 12, 2)).toBe(0);
    expect(e.grid.get(4, 0, 2)).not.toBe(0);
    for (let y = 0; y <= 12; y++) for (let k = 0; k < 5; k++) expect(e.grid.get(5 + k, y, 0)).toBe(e.grid.get(14 - k, y, 0)); // symmetric
  });
});

describe("Parts: structure", () => {
  test("pillar(s): base, shaft, capital", () => {
    const e = ed(32);
    e.run([{ op: "pillar", at: [[2, 1, 2], [6, 1, 2]], height: 6 }]);
    expect(e.grid.count).toBe(12);
    expect(hexAt(e, 2, 1, 2)).toBe(MATERIALS.stone);
    expect(hexAt(e, 2, 3, 2)).toBe(MATERIALS.pillar);
    expect(hexAt(e, 6, 6, 2)).toBe(shade(MATERIALS.pillar, 0.74));
    const s = ed(32);
    s.run([{ op: "pillar", at: [2, 0, 2], height: 4, size: 2, base: false, capital: false, color: "#123456" }]);
    expect(cellsOf(s, "#123456").length).toBe(16);
  });

  test("beam dots every N (world aligned), railing posts", () => {
    const e = ed(32);
    e.run([{ op: "beam", from: [0, 5, 3], to: [11, 5, 3] }]);
    expect(cellsOf(e, MATERIALS.gold).map((p) => p.x)).toEqual([0, 3, 6, 9]);
    expect(cellsOf(e, MATERIALS.beam).length).toBe(8);
    const r = ed(32);
    r.run([{ op: "railing", from: [0, 4, 3], to: [9, 4, 3] }]);
    expect(cellsOf(r, MATERIALS.pillar).every((p) => p.y === 5)).toBe(true);
    expect(cellsOf(r, shade(MATERIALS.pillar, 0.74)).map((p) => p.x)).toEqual([0, 2, 4, 6, 8]);
  });

  test("stairs climb away from the face", () => {
    const e = ed(32);
    e.run([{ op: "stairs", at: [4, 0, 20], face: "+z", steps: 4, width: 3, run: 2, edge: "#ffffff" }]);
    const topAt = (z: number) => { let t = -1; for (let y = 0; y < 32; y++) if (e.grid.get(5, y, z)) t = y; return t; };
    expect([20, 19, 18, 17, 16, 15, 14, 13, 12].map(topAt)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, -1]);
    expect(e.grid.count).toBe(3 * 2 * (1 + 2 + 3 + 4));
    expect(hexAt(e, 5, 3, 14)).toBe("#ffffff");
    const x = ed(32);
    x.run([{ op: "stairs", at: [10, 0, 4], face: "-x", steps: 2, width: 2 }]);
    expect(x.grid.get(10, 0, 4)).not.toBe(0);
    expect(x.grid.get(11, 1, 4)).not.toBe(0);
    expect(x.grid.get(10, 1, 4)).toBe(0);
  });

  test("crenels on chosen sides", () => {
    const e = ed(32);
    e.run([{ op: "crenels", min: [0, 10, 0], max: [8, 10, 6] }]);
    // x sides: x=0,2,4,6,8 on z=0 and z=6 (10); z sides: z=0,2,4,6 on x=0 and x=8, corners already counted
    expect(e.grid.count).toBe(10 + 4);
    const f = ed(32);
    f.run([{ op: "crenels", min: [0, 10, 0], max: [8, 11, 6], sides: ["+z"], width: 2, every: 3 }]);
    expect(f.grid.count).toBe(2 * 6); // x = 0,1,3,4,6,7 at two heights
  });

  test("lantern hangs below its hook", () => {
    const e = ed(32);
    e.run([{ op: "lantern", at: [[5, 10, 5], [9, 10, 5]] }]);
    expect([10, 9, 8, 7].map((y) => hexAt(e, 5, y, 5))).toEqual([MATERIALS.goldD, MATERIALS.lantern, MATERIALS.lantern, MATERIALS.gold]);
    expect(e.grid.count).toBe(8);
  });
});

describe("Parts: patterns", () => {
  test("brick / checker / stripes / noise", () => {
    const e = ed(32);
    e.run([{ op: "box", min: [0, 0, 0], max: [11, 5, 0], pattern: "brick", colors: ["#aa0000", "#330000", "#ff0000"] }]);
    expect(hexAt(e, 1, 0, 0)).toBe("#330000"); // mortar course every 3rd row
    expect(hexAt(e, 0, 1, 0)).toBe("#330000"); // head joint
    expect(hexAt(e, 3, 4, 0)).toBe("#330000"); // staggered head joint
    const c = ed(32);
    c.run([{ op: "box", min: [0, 0, 0], max: [3, 3, 3], pattern: "checker", colors: ["#000001", "#000002"] }]);
    expect(cellsOf(c, "#000001").length).toBe(32);
    const s = ed(32);
    s.run([{ op: "box", min: [0, 0, 0], max: [5, 0, 5], pattern: "stripes", axis: "x", scale: 2, color: "#808080" }]);
    expect(hexAt(s, 2, 0, 0)).toBe(shade("#808080", 0.85));
    const n = ed(32), m = ed(32), o = ed(32);
    const noise: Op = { op: "box", min: [0, 0, 0], max: [15, 15, 0], pattern: "noise", colors: ["#000001", "#000002", "#000003"], density: 0.3 };
    n.run([noise]); m.run([noise]); o.run([{ ...noise, seed: 4 }]);
    expect(snapshot(n)).toBe(snapshot(m));
    expect(snapshot(n)).not.toBe(snapshot(o));
    const frac = cellsOf(n, "#000001").length / 256;
    expect(frac).toBeGreaterThan(0.55);
    expect(frac).toBeLessThan(0.85);
    expect(() => ed(8).run([{ op: "box", min: [0, 0, 0], max: [1, 1, 1], pattern: "brick" }])).toThrow(/colors/);
    const h = ed(8);
    h.run([{ op: "box", min: [0, 0, 0], max: [3, 3, 3], pattern: "checker", color: 2, hollow: true }]);
    expect(h.grid.count).toBe(64 - 8);
  });

  test("hash3 is deterministic and spread", () => {
    expect(hash3(1, 2, 3, 4)).toBe(hash3(1, 2, 3, 4));
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += hash3(i, i * 7, i * 13);
    expect(sum / 1000).toBeGreaterThan(0.4);
    expect(sum / 1000).toBeLessThan(0.6);
  });
});

describe("Parts: stamp", () => {
  /** A 3-wide (x) × 1 tall × 2 deep (z) source: red front-left corner at (0,0,1), blue elsewhere. */
  function source() {
    const s = new Editor(new VoxelGrid(8), undefined);
    s.newScene(8, ["#0000ff", "#ff0000"]);
    s.run([{ op: "box", min: [2, 1, 3], max: [4, 1, 4], color: 0 }, { op: "set", voxels: [[2, 1, 4, 1]] }]);
    return s.serialize();
  }
  const red = (e: Editor) => cellsOf(e, "#ff0000").map(({ x, y, z }) => [x, y, z]);

  test("places the bbox min at `at`, merges palette", () => {
    const e = ed(16);
    e.newScene(16, ["#ffffff"]);
    e.run([{ op: "stamp", scene: source(), at: [5, 0, 5] }]);
    expect(boundingBox(e.grid)).toEqual({ min: { x: 5, y: 0, z: 5 }, max: { x: 7, y: 0, z: 6 } });
    expect(red(e)).toEqual([[5, 0, 6]]);
    expect([...e.palette.all()]).toEqual(["#ffffff", "#0000ff", "#ff0000"]);
    const o = ed(16);
    o.run([{ op: "stamp", scene: source(), at: [0, 0, 0], anchor: "origin" }]);
    expect(red(o)).toEqual([[2, 1, 4]]);
  });

  test("rotation (quarter turns about Y) and mirror", () => {
    const at = (rot: 0 | 1 | 2 | 3, mirror?: "x" | "z") => { const e = ed(16); e.run([{ op: "stamp", scene: source(), at: [5, 0, 5], rot, mirror }]); return { e, bb: boundingBox(e.grid)! }; };
    const r1 = at(1);
    expect(r1.bb.max).toEqual({ x: 6, y: 0, z: 7 }); // 2 wide × 3 deep
    expect(red(r1.e)).toEqual([[6, 0, 7]]); // front (+z) now faces +x
    expect(red(at(2).e)).toEqual([[7, 0, 5]]);
    expect(red(at(3).e)).toEqual([[5, 0, 5]]);
    expect(red(at(0, "x").e)).toEqual([[7, 0, 6]]);
    expect(red(at(0, "z").e)).toEqual([[5, 0, 5]]);
    expect(stampCells({ op: "stamp", scene: source(), rot: 3 }).length).toBe(6);
  });

  test("recolor, crop, clipping, names rejected in core", () => {
    const e = ed(16);
    e.run([{ op: "stamp", scene: source(), recolor: { "#FF0000": "#00ff00", "#0000ff": null } }]);
    expect(e.grid.count).toBe(1);
    expect(cellsOf(e, "#00ff00").length).toBe(1);
    const c = ed(16);
    c.run([{ op: "stamp", scene: source(), crop: { min: [0, 0, 4], max: [7, 7, 4] } }]);
    expect(c.grid.count).toBe(3);
    const k = ed(4);
    k.run([{ op: "stamp", scene: source(), at: [2, 3, 3] }]);
    expect(k.grid.count).toBe(2); // x 2..3 of 2..4, z 3 of 3..4
    expect(() => k.run([{ op: "stamp", scene: "house" }])).toThrow(/name/);
    const roofScene = (() => { const r = ed(48); r.run([{ op: "roof", min: [10, 10], max: [30, 22], y: 5 }]); return r.serialize(); })();
    const rs = ed(48);
    rs.run([{ op: "stamp", scene: roofScene, reshade: { [MATERIALS.roof]: "#c04030" } }]);
    expect(cellsOf(rs, shade("#c04030", 0.45)).length).toBeGreaterThan(0);
    expect(rs.info().colorsUsed.every((c) => ["#c04030", ...[0.74, 1.22, 1.42, 0.45, 0.86].map((f) => shade("#c04030", f))].includes(c.hex))).toBe(true);
  });
});

describe("Parts: batch behaviour", () => {
  const house: Op[] = [
    { op: "walls", min: [4, 1, 4], max: [20, 8, 14], skirt: 2, posts: true },
    { op: "door", at: [10, 1, 14], size: [4, 6] },
    { op: "window", at: [5, 3, 14], size: [3, 3] },
    { op: "pillar", at: [[4, 1, 16], [20, 1, 16]], height: 8 },
    { op: "beam", from: [4, 8, 16], to: [20, 8, 16] },
    { op: "roof", min: [4, 4], max: [20, 16], y: 9, pearl: true },
    { op: "lantern", at: [7, 7, 16] },
  ];

  test("a whole building is one undo step", () => {
    const e = ed(32);
    expect(e.run(house)).toBeGreaterThan(300);
    e.undo();
    expect(e.grid.count).toBe(0);
  });

  test("every part clips silently at the grid edge", () => {
    const e = ed(6);
    expect(() => e.run(house)).not.toThrow();
    expect(e.grid.count).toBeGreaterThan(0);
    const neg = ed(16);
    expect(() => neg.run([
      { op: "walls", min: [-5, -5, -5], max: [3, 3, 3] }, { op: "stairs", at: [-2, -1, 0], steps: 5 }, { op: "arch", min: [-3, 0, -3], max: [2, 4, 2] },
      { op: "crenels", min: [-4, 2, -4], max: [20, 2, 20] }, { op: "railing", from: [-3, 0, 0], to: [30, 0, 0] },
    ])).not.toThrow();
  });

  test("bad input aborts the batch", () => {
    const e = ed(16);
    expect(() => e.run([{ op: "box", min: [0, 0, 0], max: [1, 1, 1], color: 0 }, { op: "window", at: [0, 0, 0], face: "up" as never }])).toThrow(/op 1 \(window\)/);
    expect(e.grid.count).toBe(0);
    expect(() => e.run([{ op: "stairs", at: [0, 0, 0], steps: 1e9 }])).toThrow(/steps/);
  });
});
