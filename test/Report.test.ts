import { describe, expect, test } from "bun:test";
import { applyOp, Draft, planOpsReport, type Op } from "../src/core/Commands";
import { Editor } from "../src/core/Editor";
import { formatReport, summarizeReport } from "../src/core/Report";
import { applyEdit } from "../src/core/Tools";
import { VoxelGrid } from "../src/core/VoxelGrid";

const resolve = (c: number | string) => (typeof c === "number" ? c : 0) + 1;

function run(grid: VoxelGrid, ops: Op[]) {
  const { edits, report } = planOpsReport(grid, ops, resolve);
  for (const e of edits) applyEdit(grid, e);
  return { edits, report };
}

/** Brute-force count of ellipsoid cells (same rule as Commands) outside a grid of size s. */
function ellipsoidOutside(c: number[], r: number, s: number) {
  let n = 0, minX = Infinity, maxX = -Infinity;
  for (let x = c[0]! - r - 1; x <= c[0]! + r + 1; x++)
    for (let y = c[1]! - r - 1; y <= c[1]! + r + 1; y++)
      for (let z = c[2]! - r - 1; z <= c[2]! + r + 1; z++) {
        const inside = ((x - c[0]!) ** 2 + (y - c[1]!) ** 2 + (z - c[2]!) ** 2) / (r + 0.5) ** 2 <= 1;
        const inGrid = x >= 0 && y >= 0 && z >= 0 && x < s && y < s && z < s;
        if (inside && !inGrid) { n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
      }
  return { n, minX, maxX };
}

describe("write report", () => {
  test("totals and per-op counts for set / erase / recolor / no-op", () => {
    const g = new VoxelGrid(8);
    run(g, [{ op: "box", min: [0, 0, 0], max: [1, 1, 1], color: 1 }]);
    const { edits, report } = run(g, [
      { op: "box", min: [0, 0, 0], max: [2, 0, 0], color: 1 }, // 2 no-op, 1 set
      { op: "box", min: [0, 1, 0], max: [0, 1, 1], color: 3 }, // 2 recolored
      { op: "box", min: [1, 1, 0], max: [1, 1, 1], erase: true }, // 2 erased
    ]);
    expect(report.totals).toEqual({ set: 1, erased: 2, recolored: 2, noop: 2, clipped: 0, invalid: 0 });
    expect(edits.length).toBe(5);
    expect(report.ops.map((o) => [o.index, o.op, o.set, o.erased, o.recolored, o.noop])).toEqual([
      [0, "box", 1, 0, 0, 2], [1, "box", 0, 0, 2, 0], [2, "box", 0, 2, 0, 0],
    ]);
    expect(report.warnings).toEqual([]); // nothing overwrote cells set earlier in this batch
    expect(summarizeReport(report)).toBe("changed 5: +1 set, -2 erased, ~2 recolored; 2 no-op");
  });

  test("cow case: ellipsoid past the grid edge reports clipped count and bbox", () => {
    const g = new VoxelGrid(16);
    const { report } = run(g, [
      { op: "box", min: [2, 0, 2], max: [10, 4, 6], color: 1 },
      { op: "ellipsoid", center: [14, 6, 4], radius: 3, color: 2 },
    ]);
    const want = ellipsoidOutside([14, 6, 4], 3, 16);
    expect(want.n).toBeGreaterThan(0);
    const op1 = report.ops[1]!;
    expect(op1.clipped).toBe(want.n);
    expect(op1.clipBox!.min.x).toBe(16);
    expect(op1.clipBox!.max.x).toBe(want.maxX);
    expect(report.ops[0]!.clipped).toBe(0);
    expect(report.totals.clipped).toBe(want.n);
    expect(report.warnings[0]).toBe(`op 1 (ellipsoid): ${want.n} cells clipped outside the grid (x 16..${want.maxX}; grid 0..15)`);
  });

  test("canopy case: a later op erasing cells an earlier op just set is a warning", () => {
    const g = new VoxelGrid(16);
    const { report } = run(g, [
      { op: "ellipsoid", center: [5, 8, 8], radius: 3, color: 2 },
      { op: "box", min: [0, 0, 0], max: [2, 2, 2], color: 1 },
      { op: "ellipsoid", center: [9, 8, 8], radius: 3, erase: true },
    ]);
    const op2 = report.ops[2]!;
    expect(op2.erased).toBeGreaterThan(0);
    expect(op2.overwrote).toEqual([{ op: 0, erased: op2.erased, recolored: 0 }]);
    // net over the batch those cells were never filled
    expect(report.totals.erased).toBe(0);
    expect(report.warnings).toEqual([`op 2 (ellipsoid): erased ${op2.erased} cells set by op 0 in this batch`]);
  });

  test("recoloring cells set earlier in the batch is a note; several sources are listed", () => {
    const g = new VoxelGrid(8);
    const { report } = run(g, [
      { op: "box", min: [0, 0, 0], max: [1, 0, 0], color: 1 },
      { op: "box", min: [2, 0, 0], max: [3, 0, 0], color: 2 },
      { op: "box", min: [1, 0, 0], max: [2, 0, 0], color: 3 },
    ]);
    expect(report.ops[2]!.overwrote).toEqual([{ op: 0, erased: 0, recolored: 1 }, { op: 1, erased: 0, recolored: 1 }]);
    expect(report.notes).toEqual(["op 2 (box): recolored 2 cells set by ops 0, 1 in this batch"]);
    expect(report.warnings).toEqual([]);
  });

  test("erasing cells that existed before the batch is not an overwrite warning", () => {
    const g = new VoxelGrid(8);
    run(g, [{ op: "box", min: [0, 0, 0], max: [3, 3, 3], color: 1 }]);
    const { report } = run(g, [{ op: "box", min: [0, 0, 0], max: [1, 1, 1], erase: true }]);
    expect(report.totals.erased).toBe(8);
    expect(report.ops[0]!.overwrote).toBeUndefined();
    expect(report.warnings).toEqual([]);
  });

  test("set op: out-of-grid writes are clipped, non-integer are invalid, erasing outside is ignored", () => {
    const g = new VoxelGrid(4);
    const { report } = run(g, [{ op: "set", voxels: [[0, 0, 0, 1], [5, 0, -1, 1], [6, 2, 0, 1], [1.5, 0, 0, 1], [9, 9, 9, null]] }]);
    expect(report.totals).toMatchObject({ set: 1, clipped: 2, invalid: 1 });
    expect(report.ops[0]!.clipBox).toEqual({ min: { x: 5, y: 0, z: -1 }, max: { x: 6, y: 2, z: 0 } });
    expect(report.warnings[0]).toBe("op 0 (set): 2 cells clipped outside the grid (x 5..6, z -1..0; grid 0..3)");
    expect(report.warnings[1]).toBe("op 0 (set): 1 writes ignored (non-integer coordinates)");
  });

  test("hollow shapes only count the clipped shell; erase shapes never clip; mirror/translate clip via set", () => {
    const g = new VoxelGrid(8);
    const solid = run(new VoxelGrid(8), [{ op: "box", min: [6, 0, 0], max: [9, 3, 3], color: 1 }]).report;
    expect(solid.totals.clipped).toBe(2 * 4 * 4);
    const hollow = run(new VoxelGrid(8), [{ op: "box", min: [6, 0, 0], max: [9, 3, 3], color: 1, hollow: true }]).report;
    expect(hollow.totals.clipped).toBe(4 * 4 - 2 * 2 + 4 * 4); // x=8 ring + x=9 face
    expect(run(g, [{ op: "box", min: [-3, 0, 0], max: [2, 1, 1], erase: true }]).report.totals.clipped).toBe(0);
    const mir = run(new VoxelGrid(8), [{ op: "set", voxels: [[1, 0, 0, 1]] }, { op: "mirror", axis: "x", pivot: 10 }]).report;
    expect(mir.ops[1]!.clipped).toBe(1);
    const tr = run(new VoxelGrid(8), [{ op: "box", min: [5, 0, 0], max: [6, 0, 0], color: 1 }, { op: "translate", offset: [2, 0, 0] }]).report;
    expect(tr.ops[1]!).toMatchObject({ clipped: 1, erased: 2, set: 1 }); // 5,6 -> 7 (kept), 8 (clipped)
  });

  test("huge out-of-grid shapes give an estimate instead of scanning", () => {
    const { report } = run(new VoxelGrid(8), [{ op: "box", min: [-1000, -1000, -1000], max: [1000, 1000, 1000], color: 1 }]);
    expect(report.ops[0]!.clipApprox).toBe(true);
    expect(report.totals.clipped).toBe(2001 ** 3 - 8 ** 3);
    expect(report.totals.set).toBe(8 ** 3);
    expect(report.warnings[0]).toStartWith("op 0 (box): ~");
  });

  test("a cell written many times by one op counts once (thick line)", () => {
    const { report } = run(new VoxelGrid(16), [{ op: "line", from: [2, 8, 8], to: [12, 8, 8], radius: 1, color: 1 }]);
    expect(report.totals.set).toBe(report.ops[0]!.set);
    expect(report.totals.noop).toBe(0);
  });

  test("Draft: loose writes form implicit 'set' ops; empty implicit ops are dropped", () => {
    const d = new Draft(new VoxelGrid(4));
    d.beginOp("set", true); // like run_script's start: nothing written yet
    applyOp(d, { op: "box", min: [0, 0, 0], max: [0, 0, 0], color: 1 }, resolve);
    d.beginOp("box");
    applyOp(d, { op: "box", min: [1, 0, 0], max: [1, 0, 0], color: 1 }, resolve);
    d.beginOp("set", true);
    d.set(2, 0, 0, 2);
    d.set(7, 0, 0, 2);
    d.beginOp("set", true); // empty
    const r = d.report();
    expect(r.ops.map((o) => [o.index, o.op, o.set, o.clipped])).toEqual([[0, "set", 1, 0], [1, "box", 1, 0], [2, "set", 1, 1]]);
    expect(r.totals.set).toBe(3);
  });

  test("Editor.runReport and formatReport (warnings lead)", () => {
    const ed = new Editor(new VoxelGrid(8));
    const { changed, report } = ed.runReport([
      { op: "box", min: [0, 0, 0], max: [3, 3, 3], color: "#ff0000" },
      { op: "box", min: [6, 0, 0], max: [9, 0, 0], color: 1 },
      { op: "box", min: [0, 0, 0], max: [0, 3, 3], erase: true },
    ]);
    expect(changed).toBe(64 - 16 + 2);
    expect(ed.grid.count).toBe(changed);
    const text = formatReport(report).split("\n");
    expect(text[0]).toBe("WARNING: op 1 (box): 2 cells clipped outside the grid (x 8..9; grid 0..7)");
    expect(text[1]).toBe("WARNING: op 2 (box): erased 16 cells set by op 0 in this batch");
    // the 16 cells drawn then erased end where they started: net no-ops for the batch
    expect(text[2]).toBe("changed 50: +50 set, -0 erased, ~0 recolored; 16 no-op; 2 clipped");
    expect(text[3]).toBe("ops: #0 box +64 | #1 box +2 2 clipped | #2 box -16");
    expect(ed.run([{ op: "box", min: [0, 0, 0], max: [0, 0, 0], color: 2 }])).toBe(1); // run still returns a count
  });
});
