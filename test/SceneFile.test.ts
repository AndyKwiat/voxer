import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSceneData, readSceneFile, writeSceneFile } from "../server/SceneFile";

const scene = { version: 1 as const, size: 4, palette: ["#000000"], data: "AEA=" };
const dir = mkdtempSync(join(tmpdir(), "voxer-scenefile-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("scene files at absolute paths", () => {
  test("save with path writes the file (creating parent dirs); load reads it back", async () => {
    const p = join(dir, "nested", "deeper", "house.json");
    expect(await writeSceneFile(p, scene)).toBe(p);
    expect(existsSync(p)).toBe(true);
    expect(JSON.parse(await Bun.file(p).text())).toEqual(scene);
    expect(await readSceneFile(p)).toEqual(scene);
  });

  test("rejects relative paths, missing files and non-scenes", async () => {
    await expect(writeSceneFile("models/x.json", scene)).rejects.toThrow("absolute");
    await expect(readSceneFile("x.json")).rejects.toThrow("absolute");
    await expect(readSceneFile(join(dir, "nope.json"))).rejects.toThrow("no file");
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ hello: 1 }));
    await expect(readSceneFile(bad)).rejects.toThrow("not a Voxer scene");
    await expect(writeSceneFile(join(dir, "y.json"), { version: 2 } as never)).rejects.toThrow("not a scene");
  });

  test("isSceneData", () => {
    expect(isSceneData(scene)).toBe(true);
    expect(isSceneData(null)).toBe(false);
    expect(isSceneData({ ...scene, size: 0 })).toBe(false);
    expect(isSceneData({ ...scene, data: 3 })).toBe(false);
  });
});
