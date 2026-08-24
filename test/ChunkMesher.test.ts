import { describe, expect, test } from "bun:test";
import { buildChunkGeometry, CHUNK } from "../src/render/ChunkMesher";
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

describe("ChunkedVoxelMesh", () => {
  test("marks border neighbours only when in bounds; update clears dirty", async () => {
    const { ChunkedVoxelMesh } = await import("../src/render/ChunkMesher");
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
});
