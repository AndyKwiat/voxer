import { describe, expect, test } from "bun:test";
import { AO_LEVELS, aoLevel, linearToSrgb, meshGrid, srgbToLinear, type MeshData } from "../src/core/GreedyMesher";
import { VoxelGrid } from "../src/core/VoxelGrid";

const WHITE = ["#ffffff"];
function gridWith(size: number, cells: [number, number, number, number?][]): VoxelGrid {
  const g = new VoxelGrid(size);
  for (const [x, y, z, v] of cells) g.set(x, y, z, v ?? 1);
  return g;
}

/** Quads (4 vertices each, in emission order) whose normal is `n`. */
function quads(m: MeshData, n: [number, number, number]) {
  const out: { pos: number[][]; col: number[][] }[] = [];
  for (let q = 0; q < m.vertexCount / 4; q++) {
    const k = q * 12;
    if (m.normals[k] !== n[0] || m.normals[k + 1] !== n[1] || m.normals[k + 2] !== n[2]) continue;
    const pos: number[][] = [], col: number[][] = [];
    for (let i = 0; i < 4; i++) {
      pos.push([...m.positions.subarray(k + i * 3, k + i * 3 + 3)]);
      col.push([...m.colors.subarray(k + i * 3, k + i * 3 + 3)]);
    }
    out.push({ pos, col });
  }
  return out;
}

describe("meshGrid", () => {
  test("a single voxel is 6 quads / 12 triangles, wound CCW from outside", () => {
    const m = meshGrid(gridWith(4, [[1, 1, 1]]), WHITE, { pivot: "corner" });
    expect(m.triangleCount).toBe(12);
    expect(m.vertexCount).toBe(24);
    expect(m.indices.length).toBe(36);
    expect(m.indices).toBeInstanceOf(Uint16Array);
    expect(m.bbox).toEqual({ min: [1, 1, 1], max: [2, 2, 2] });
    // every triangle's geometric normal matches its vertex normal
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map((i) => [...m.positions.subarray(i * 3, i * 3 + 3)]) as number[][];
      const e1 = a!.map((v, i) => b![i]! - v), e2 = a!.map((v, i) => c![i]! - v);
      const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const i0 = m.indices[t]! * 3;
      expect(cr[0]! * m.normals[i0]! + cr[1]! * m.normals[i0 + 1]! + cr[2]! * m.normals[i0 + 2]!).toBeGreaterThan(0);
    }
    // isolated voxel: no occlusion; bottom face shaded 0.8
    expect(quads(m, [0, 1, 0])[0]!.col.flat().every((c) => c === 1)).toBe(true);
    expect(quads(m, [0, -1, 0])[0]!.col.flat().every((c) => Math.abs(c - 0.8) < 1e-6)).toBe(true);
  });

  test("an empty grid gives an empty mesh", () => {
    const m = meshGrid(new VoxelGrid(4), WHITE);
    expect(m.triangleCount).toBe(0);
    expect(m.bbox).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });

  test("a 4×1×1 bar merges its long faces", () => {
    const g = gridWith(8, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]);
    const unmerged = meshGrid(g, WHITE, { merge: false });
    const merged = meshGrid(g, WHITE);
    expect(unmerged.triangleCount).toBe(36); // 18 exposed faces
    expect(merged.triangleCount).toBe(12); // 4 long sides + 2 ends
    expect(merged.triangleCount).toBeLessThan(unmerged.triangleCount);
    expect(merged.bbox).toEqual(unmerged.bbox);
  });

  test("faces don't merge where AO differs, or across colors", () => {
    // a voxel standing on the bar's first cell darkens the top face of cell 1 next to it
    const g = gridWith(8, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [0, 1, 0]]);
    const tops = quads(meshGrid(g, WHITE, { pivot: "corner" }), [0, 1, 0]).filter((q) => q.pos[0]![1] === 1);
    expect(tops.length).toBe(2); // x=1 (AO varies along x) + x=2..3 merged
    const xs = tops.map((q) => q.pos.map((p) => p[0]!)).map((x) => [Math.min(...x), Math.max(...x)]).sort((a, b) => a[0]! - b[0]!);
    expect(xs).toEqual([[1, 2], [2, 4]]);
    // without AO the same three tops merge into one
    const flat = quads(meshGrid(g, WHITE, { pivot: "corner", ao: false }), [0, 1, 0]).filter((q) => q.pos[0]![1] === 1);
    expect(flat.length).toBe(1);
    // two colors: no merge between them, unless remapped to the same color
    const two = gridWith(8, [[0, 0, 0, 1], [1, 0, 0, 2]]);
    expect(meshGrid(two, ["#ff0000", "#00ff00"]).triangleCount).toBe(20);
    expect(meshGrid(two, ["#ff0000", "#00ff00"], { remap: { "#00FF00": "#ff0000" } }).triangleCount).toBe(12);
  });

  test("AO levels on a known corner configuration", () => {
    expect(aoLevel(false, false, false)).toBe(3);
    expect(aoLevel(true, false, false)).toBe(2);
    expect(aoLevel(false, false, true)).toBe(2);
    expect(aoLevel(true, false, true)).toBe(1);
    expect(aoLevel(true, true, false)).toBe(0);
    // A at (1,1,1); its top face sees: (2,2,1) on +x, (1,2,2) on +z, (0,2,0) diagonally at -x/-z
    const g = gridWith(4, [[1, 1, 1], [2, 2, 1], [1, 2, 2], [0, 2, 0]]);
    const m = meshGrid(g, WHITE, { pivot: "corner" });
    const top = quads(m, [0, 1, 0]).filter((q) => q.pos[0]![1] === 2);
    expect(top.length).toBe(1);
    const at = (x: number, z: number) => top[0]!.col[top[0]!.pos.findIndex((p) => p[0] === x && p[2] === z)]![0]!;
    expect(at(1, 1)).toBeCloseTo(AO_LEVELS[2]); // only the diagonal (0,2,0)
    expect(at(2, 1)).toBeCloseTo(AO_LEVELS[2]); // side (2,2,1)
    expect(at(1, 2)).toBeCloseTo(AO_LEVELS[2]); // side (1,2,2)
    expect(at(2, 2)).toBeCloseTo(AO_LEVELS[0]); // both sides → fully occluded
    // the quad is split along the brighter diagonal: (1,1)-(2,2) has AO 2+0 < 2+2, so the split avoids it
    const qi = Array.from(m.indices);
    const darkV = Array.from({ length: m.vertexCount }, (_, i) => i).find((i) =>
      m.normals[i * 3 + 1] === 1 && m.positions[i * 3] === 2 && m.positions[i * 3 + 1] === 2 && m.positions[i * 3 + 2] === 2)!;
    expect(qi.filter((i) => i === darkV).length).toBe(1); // dark corner belongs to one triangle only
  });

  test("pivot and scale", () => {
    const g = gridWith(4, [[0, 0, 0]]);
    expect(meshGrid(g, WHITE, { pivot: "corner" }).bbox).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
    expect(meshGrid(g, WHITE).bbox).toEqual({ min: [-2, 0, -2], max: [-1, 1, -1] }); // base is the default
    expect(meshGrid(g, WHITE, { pivot: "center", scale: 0.5 }).bbox).toEqual({ min: [-1, -1, -1], max: [-0.5, -0.5, -0.5] });
    expect(() => meshGrid(g, WHITE, { scale: 0 })).toThrow();
    expect(() => meshGrid(g, WHITE, { pivot: "x" as never })).toThrow();
  });

  test("colors are linear (sRGB palette decoded)", () => {
    const m = meshGrid(gridWith(4, [[0, 0, 0]]), ["#808080"], { ao: false });
    expect(m.colors[0]).toBeCloseTo(srgbToLinear(128 / 255), 6);
    expect(m.colors[0]).toBeCloseTo(0.2158605, 5);
    expect(linearToSrgb(srgbToLinear(0.3))).toBeCloseTo(0.3, 6);
  });

  test("switches to 32-bit indices past 65535 vertices", () => {
    // checkerboard: no merging possible, 6 quads per voxel
    const g = new VoxelGrid(32);
    for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if ((x + y + z) % 2 === 0) g.set(x, y, z, 1);
    const m = meshGrid(g, WHITE);
    expect(m.vertexCount).toBe(16384 * 24);
    expect(m.indices).toBeInstanceOf(Uint32Array);
  });
});
