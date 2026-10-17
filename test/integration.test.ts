// Cross-feature checks: parts + write reports + slots/anchors + scene files + export working together.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSceneFile, writeSceneFile } from "../server/SceneFile";
import type { Op } from "../src/core/Commands";
import { Editor } from "../src/core/Editor";
import { meshGrid } from "../src/core/GreedyMesher";
import { isSceneData } from "../src/core/Scene";

const house = (await Bun.file(join(import.meta.dir, "../examples/house.json")).json()) as { size: number; ops: Op[] };
const dir = mkdtempSync(join(tmpdir(), "voxer-int-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function v2House(): Editor {
  const e = new Editor();
  e.newScene(house.size);
  e.defineSlot("roof", "#3a9ab0", { dark: 0.74 });
  e.run(house.ops);
  e.setAnchor("door", { x: 20, y: 0, z: 31, dir: "+z" });
  return e;
}

describe("integration", () => {
  test("a v2 scene (slots + anchors) is valid for scene files, the server check and stamp", async () => {
    const scene = v2House().serialize();
    expect(scene.version).toBe(2);
    expect(isSceneData(scene)).toBe(true);
    const path = join(dir, "house.json");
    await writeSceneFile(path, scene);
    expect((await readSceneFile(path)).anchors?.door?.z).toBe(31);

    const e = new Editor();
    e.newScene(80);
    const { report } = e.runReport([{ op: "stamp", scene, at: [2, 0, 2] }, { op: "stamp", scene, at: [42, 0, 2], rot: 1 }] as Op[]);
    expect(report.totals.set).toBe(2 * 4420);
    expect(report.warnings).toEqual([]);
  });

  test("doors and windows carving walls are notes, not warnings; a plain erase still warns", () => {
    const e = new Editor();
    e.newScene(house.size);
    const { report } = e.runReport(house.ops);
    expect(report.warnings).toEqual([]);
    expect(report.notes.some((n) => /\(door\): erased/.test(n))).toBe(true);

    const r2 = e.runReport([
      { op: "ellipsoid", center: [8, 8, 8], radius: [4, 4, 4], color: "#00ff00" },
      { op: "ellipsoid", center: [11, 8, 8], radius: [3, 3, 3], erase: true },
    ] as Op[]).report;
    expect(r2.warnings.some((w) => /erased \d+ cells set by op 0/.test(w))).toBe(true);
  });

  test("parts output lints and meshes", () => {
    const e = v2House();
    const m = meshGrid(e.grid, e.palette.all());
    expect(m.triangleCount).toBeGreaterThan(1000);
    expect(m.triangleCount).toBeLessThan(8000);
  });
});
