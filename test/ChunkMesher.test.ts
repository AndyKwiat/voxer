import { describe, expect, test } from "bun:test";
import { buildChunkEdgeGeometry, buildChunkGeometry, ChunkedVoxelMesh, CHUNK, srgbToLinear } from "../src/render/ChunkMesher";
import { Palette } from "../src/core/Palette";
import { VoxelGrid } from "../src/core/VoxelGrid";

describe("buildChunkGeometry", () => {
  const p = new Palette(["#ff0000", "#00ff00"]);

  test("empty chunk yields null", () => {
    expect(buildChunkGeometry(new VoxelGrid(32), p, 0, 0, 0)).toBeNull();
  });

  test("a lone voxel has 6 faces (24 verts, 36 indices) with its palette color", () => {
    const g = new VoxelGrid(32);
    g.set(1, 1, 1, Palette.toCell(1));
    const geo = buildChunkGeometry(g, p, 0, 0, 0)!;
    expect(geo.getAttribute("position").count).toBe(24);
    expect(geo.getIndex()!.count).toBe(36);
    expect(Array.from(geo.getAttribute("color").array.slice(0, 3))).toEqual([0, 1, 0]);
  });

  test("vertex colors are converted from sRGB to three's linear working space", () => {
    // Feeding sRGB values straight through lifted midtones and skewed hues (brown read as orange).
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 6);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4);

    const g = new VoxelGrid(32);
    const brown = new Palette(["#7f3f00"]);
    g.set(0, 0, 0, Palette.toCell(0));
    const c = buildChunkGeometry(g, brown, 0, 0, 0)!.getAttribute("color").array;
    expect(c[0]).toBeCloseTo(srgbToLinear(0x7f / 255), 6);
    expect(c[1]).toBeCloseTo(srgbToLinear(0x3f / 255), 6);
    expect(c[2]).toBe(0);
    // the green:red ratio of the source survives the round trip back to sRGB
    const back = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    expect(back(c[1]!) / back(c[0]!)).toBeCloseTo(0x3f / 0x7f, 3);
  });

  test("shared faces between neighbours are culled, across chunk borders too", () => {
    const g = new VoxelGrid(32);
    g.set(CHUNK - 1, 0, 0, 1);
    g.set(CHUNK, 0, 0, 1);
    const a = buildChunkGeometry(g, p, 0, 0, 0)!;
    const b = buildChunkGeometry(g, p, 1, 0, 0)!;
    expect(a.getAttribute("position").count).toBe(20);
    expect(b.getAttribute("position").count).toBe(20);
  });
});

describe("buildChunkEdgeGeometry", () => {
  const segments = (geo: { getAttribute(n: string): { count: number } } | null) =>
    geo ? geo.getAttribute("position").count / 2 : 0;

  test("empty chunk yields null", () => {
    expect(buildChunkEdgeGeometry(new VoxelGrid(32), 0, 0, 0)).toBeNull();
  });

  test("a lone voxel is outlined by its 12 cube edges", () => {
    const g = new VoxelGrid(32);
    g.set(1, 1, 1, 1);
    expect(segments(buildChunkEdgeGeometry(g, 0, 0, 0))).toBe(12);
  });

  test("touching voxels share the seam and drop hidden faces' edges", () => {
    const g = new VoxelGrid(32);
    g.set(1, 1, 1, 1);
    g.set(2, 1, 1, 1);
    // 12 edges per cube, minus the 4 they share along the seam.
    expect(segments(buildChunkEdgeGeometry(g, 0, 0, 0))).toBe(20);
  });

  test("each chunk outlines its own voxels, hidden faces included in the seam", () => {
    const g = new VoxelGrid(32);
    g.set(CHUNK - 1, 0, 0, 1);
    g.set(CHUNK, 0, 0, 1);
    // The touching face is culled, but its 4 edges still border the 4 visible side faces,
    // so each voxel keeps a full 12-edge box — which is the point: you can see cell boundaries.
    expect(segments(buildChunkEdgeGeometry(g, 0, 0, 0))).toBe(12);
    expect(segments(buildChunkEdgeGeometry(g, 1, 0, 0))).toBe(12);
  });
});

describe("ChunkedVoxelMesh", () => {
  test("marks border neighbours only when in bounds; update clears dirty", () => {
    const g = new VoxelGrid(32);
    const m = new ChunkedVoxelMesh(g, new Palette(["#ffffff"]));
    m.markVoxel(0, 0, 0);
    expect(m.dirtyCount).toBe(1);
    m.markVoxel(CHUNK - 1, 5, 5);
    expect(m.dirtyCount).toBe(2); // chunk 0 + chunk 1 in x
    m.markVoxel(31, 31, 31);
    expect(m.dirtyCount).toBe(3); // at the grid edge, no +1 neighbours
    g.set(31, 31, 31, 1);
    m.update();
    expect(m.dirtyCount).toBe(0);
    expect(m.group.children.length).toBe(1);
    m.markAll();
    expect(m.dirtyCount).toBe(1);
  });

  test("setEdges builds outlines only while on", () => {
    const g = new VoxelGrid(32);
    g.set(1, 1, 1, 1);
    const m = new ChunkedVoxelMesh(g, new Palette(["#ffffff"]));
    m.markVoxel(1, 1, 1);
    m.update();
    expect(m.edgesVisible).toBe(false);
    expect(m.edgeGroup.children.length).toBe(0);

    m.setEdges(true);
    expect(m.dirtyCount).toBe(1); // existing chunks are re-meshed to pick up outlines
    m.update();
    expect(m.edgeGroup.children.length).toBe(1);

    m.setEdges(true); // idempotent
    expect(m.dirtyCount).toBe(0);

    m.setEdges(false);
    expect(m.edgeGroup.children.length).toBe(0);
    expect(m.group.children.length).toBe(1); // the solid mesh is untouched
  });
});
