import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  batchOps, expandRecipe, normalizeRecipes, parseRecipeRef, resolveSlotRefs, rng, stampAnchors, stampRecipeRefs,
  summaryLine, validateRecipe, type RecipeContext, type RecipeOp,
} from "../scripts/lib/recipe";
import { buildRecipes, exportSpecs, loadRecipeFile, loadRecipes } from "../scripts/lib/recipe-build";
import { coreHost } from "../scripts/lib/recipe-host";
import { boundingBox } from "../src/core/Commands";
import { Editor } from "../src/core/Editor";
import { stampCells } from "../src/core/Parts";
import { readSceneFile } from "../server/SceneFile";

const ROOT = resolve(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "voxer-recipe-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const box: RecipeOp = { op: "box", min: [0, 0, 0], max: [1, 1, 1], color: "#ff0000" };

describe("recipe loading / validation", () => {
  test("module shapes: default recipe, array, record, named exports, JSON value", () => {
    expect(normalizeRecipes({ default: { ops: [box] } }, "file").map((r) => [r.name, r.size])).toEqual([["file", 32]]);
    expect(normalizeRecipes({ default: [{ name: "a", ops: [] }, { name: "b", ops: [] }] }, "f").map((r) => r.name)).toEqual(["a", "b"]);
    expect(normalizeRecipes({ default: { a: { ops: [] }, b: { name: "bee", ops: [] } } }, "f").map((r) => r.name)).toEqual(["a", "bee"]);
    expect(normalizeRecipes({ house: { ops: [] }, helper: () => 1, tree: { build: () => [] } }, "f").map((r) => r.name)).toEqual(["house", "tree"]);
    expect(normalizeRecipes({ name: "j", size: 40, ops: [box] }, "f").map((r) => [r.name, r.size])).toEqual([["j", 40]]);
    expect(normalizeRecipes({ helper: () => 1 }, "f")).toEqual([]); // helper module: nothing
    expect(() => normalizeRecipes({ default: { size: 4 } }, "f")).toThrow(/not a recipe/);
    expect(() => normalizeRecipes({ default: [{ name: "a", ops: [] }, { name: "a", ops: [] }] }, "f")).toThrow(/two recipes are named "a"/);
  });

  test("validation reports every problem", () => {
    let msg = "";
    try {
      validateRecipe({
        name: "bad name", size: 999, ops: [{ op: "nope" }, 5], slots: { roof: { base: "blue", shades: { dark: 99 } } },
        anchors: { door: { x: 1.5, y: 0, z: 0 } }, variants: { gold: { wall: "#ffffff" } }, export: ["fbx"], colour: 1,
      }, undefined, "x");
    } catch (e) { msg = (e as Error).message; }
    for (const s of ["unknown key \"colour\"", "name must match", "size must be", "unknown op \"nope\"", "op 1: expected", "slot roof: base", "roof.dark: factor", "anchor door", "variant gold: no slot \"wall\"", "export[0]"]) expect(msg).toContain(s);
    expect(() => validateRecipe({ ops: [], build: () => [] }, "r", "x")).toThrow(/exactly one of ops/);
    expect(() => validateRecipe({ ops: [{ op: "stamp", recipe: "a", scene: {} }] }, "r", "x")).toThrow(/exactly one of recipe/);
    expect(() => validateRecipe({ ops: [], sheet: { views: ["side"] } }, "r", "x")).toThrow(/unknown view/);
    const ok = validateRecipe({ size: 16, ops: [box], slots: { roof: "#3a9ab0" }, variants: { red: { roof: "#c04030" } }, export: ["glb", { format: "obj", scale: 0.1 }] }, "r", "x", "/a/r.js");
    expect([ok.name, ok.size, ok.source]).toEqual(["r", 16, "/a/r.js"]);
  });

  test("files: JSON and modules load fresh; dirs skip helper modules", async () => {
    const dir = join(tmp, "load");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.json"), JSON.stringify({ size: 8, ops: [box] }));
    writeFileSync(join(dir, "lib.js"), "export const helper = () => 1;");
    writeFileSync(join(dir, "b.js"), "export default { name: 'bee', ops: [] };");
    expect((await loadRecipes([dir])).map((r) => r.name)).toEqual(["a", "bee"]);
    writeFileSync(join(dir, "b.js"), "export default { name: 'bee2', ops: [] };");
    expect((await loadRecipeFile(join(dir, "b.js")))[0]!.name).toBe("bee2"); // not the cached module
    await expect(loadRecipes([join(dir, "lib.js")])).rejects.toThrow(/exports no recipes/);
    writeFileSync(join(dir, "c.json"), JSON.stringify({ name: "a", ops: [] }));
    await expect(loadRecipes([dir])).rejects.toThrow(/defined twice/);
  });
});

describe("slot references", () => {
  const colors = { roof: { base: "#3a9ab0", dark: "#2b7282" }, wall: { base: "#f6e8c8" } };

  test("values and keys are replaced deeply; others untouched", () => {
    const op = { op: "roof", color: "slot:roof", ramp: { dark: "slot:roof.dark" }, colors: ["slot:wall", "#123456"], reshade: { "slot:roof": "#c04030" } };
    expect(resolveSlotRefs(op, colors) as unknown).toEqual({ op: "roof", color: "#3a9ab0", ramp: { dark: "#2b7282" }, colors: ["#f6e8c8", "#123456"], reshade: { "#3a9ab0": "#c04030" } });
    const plain = { op: "box", voxels: [[1, 2, 3, "#ffffff"]] };
    expect(resolveSlotRefs(plain, colors)).toBe(plain); // nothing to replace → same object
  });

  test("errors name the path and the known slots / shades", () => {
    expect(() => resolveSlotRefs({ color: "slot:door" }, colors, "op 2 (box)")).toThrow(/op 2 \(box\)\.color: unknown slot "door" \(slots: roof, wall\)/);
    expect(() => resolveSlotRefs({ c: ["slot:roof.light"] }, colors, "op 0")).toThrow(/op 0\.c\[0\]: slot "roof" has no shade "light" \(shades: base, dark\)/);
    expect(() => resolveSlotRefs("slot:", colors, "x")).toThrow(/bad slot reference/);
  });
});

describe("expandRecipe / build(ctx)", () => {
  const colors = { leaf: { base: "#3aa848", dark: "#2e8638" } };

  test("ctx.set batches into set ops in call order; returned / yielded ops follow; anchors merge", async () => {
    const r = validateRecipe({
      size: 8, anchors: { a: { x: 0, y: 0, z: 0 } },
      *build(ctx: RecipeContext) {
        ctx.set(0.4, 0, 0, ctx.slots.leaf!.dark!);
        ctx.set(1, 0, 0, "slot:leaf");
        ctx.box([2, 0, 0], [2, 1, 0], "slot:leaf.dark");
        ctx.set(3, 0, 0, ctx.slot("leaf"));
        yield { op: "line", from: [0, 1, 0], to: [3, 1, 0], color: "slot:leaf" };
        ctx.anchor("b", { x: 1, y: 2, z: 3, dir: "+y" });
      },
    }, "t", "x");
    const { ops, anchors } = await expandRecipe(r, colors);
    expect(ops).toEqual([
      { op: "set", voxels: [[0, 0, 0, "#2e8638"], [1, 0, 0, "#3aa848"]] },
      { op: "box", min: [2, 0, 0], max: [2, 1, 0], color: "#2e8638" },
      { op: "set", voxels: [[3, 0, 0, "#3aa848"]] },
      { op: "line", from: [0, 1, 0], to: [3, 1, 0], color: "#3aa848" },
    ]);
    expect(anchors).toEqual({ a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 2, z: 3, dir: "+y" } });
  });

  test("build may return an array or { ops, anchors }; rng is seeded; bad ops are caught", async () => {
    const arr = await expandRecipe(validateRecipe({ build: () => [box] }, "t", "x"), {});
    expect(arr.ops).toEqual([box]);
    const obj = await expandRecipe(validateRecipe({ build: async () => ({ ops: [box], anchors: { top: { x: 1, y: 2, z: 3 } } }) }, "t", "x"), {});
    expect(obj.anchors).toEqual({ top: { x: 1, y: 2, z: 3 } });
    const draw = (seed: number) => { const g = rng(seed); return [g(), g(), g()]; };
    expect(draw(3)).toEqual(draw(3));
    expect(draw(3)).not.toEqual(draw(4));
    await expect(expandRecipe(validateRecipe({ build: () => [{ op: "blob" } as RecipeOp] }, "t", "x"), {})).rejects.toThrow(/op 0: unknown op "blob"/);
    await expect(expandRecipe(validateRecipe({ ops: [{ op: "box", color: "slot:nope" }] }, "t", "x"), colors)).rejects.toThrow(/op 0 \(box\)\.color: unknown slot "nope"/);
  });
});

describe("batching, stamp refs, anchors through stamps", () => {
  test("batchOps keeps order, caps ops per batch and splits big set ops", () => {
    const sets = { op: "set", voxels: Array.from({ length: 25 }, (_, i) => [i, 0, 0, 1]) };
    const b = batchOps([box, sets, box, box], 3, 10);
    expect(b.map((x) => x.map((o) => (o.op === "set" ? (o.voxels as unknown[]).length : o.op)))).toEqual([["box"], [10], [10], [5, "box", "box"]]);
    expect(batchOps([]).length).toBe(0);
  });

  test("stamp recipe refs and ref parsing", () => {
    expect(stampRecipeRefs([{ op: "stamp", recipe: "house" }, box, { op: "stamp", recipe: "house", at: [1, 0, 0] }, { op: "stamp", recipe: "./t.js#tree" }])).toEqual(["house", "./t.js#tree"]);
    expect(parseRecipeRef("house")).toEqual({ name: "house" });
    expect(parseRecipeRef("./lib/house.js")).toEqual({ file: "./lib/house.js", name: undefined });
    expect(parseRecipeRef("houses.ts#home2")).toEqual({ file: "houses.ts", name: "home2" });
  });

  test("stampAnchors moves anchors exactly like stampCells moves cells (rot, mirror, origin frame)", () => {
    const src = new Editor();
    src.newScene(16);
    src.run([{ op: "box", min: [3, 1, 4], max: [7, 2, 6], color: "#aa0000" }, { op: "set", voxels: [[3, 1, 6, "#00ff00"]] }]);
    const scene = src.serialize();
    const marker = { x: 3, y: 1, z: 6, dir: "+z" as const }; // the green cell, facing +z
    for (const rot of [0, 1, 2, 3] as const) for (const mirror of [undefined, "x", "z"] as const) for (const anchor of ["bbox", "origin"] as const) {
      const op = { op: "stamp" as const, scene, at: [10, 2, 5] as [number, number, number], rot, mirror, anchor };
      const green = stampCells(op).filter((c) => scene.palette[c.value - 1] === "#00ff00");
      const a = stampAnchors({ m: marker }, { bbox: boundingBox(src.grid), size: 16 }, op, "p_").p_m!;
      expect([a.x, a.y, a.z]).toEqual([green[0]!.x, green[0]!.y, green[0]!.z]);
    }
    const turned = (rot: number, mirror?: string) => stampAnchors({ m: marker }, { bbox: boundingBox(src.grid), size: 16 }, { rot, mirror }, "").m!.dir;
    expect([turned(0), turned(1), turned(2), turned(3), turned(0, "z"), turned(1, "x")]).toEqual(["+z", "+x", "-z", "-x", "-z", "+x"]);
  });

  test("exportSpecs merges recipe options with extra formats", () => {
    expect(exportSpecs(["glb", { format: "obj", scale: 0.1 }], ["obj", "json"])).toEqual([{ format: "glb" }, { format: "obj", scale: 0.1 }, { format: "json" }]);
    expect(summaryLine({ name: "x", voxels: 5, bbox: null, warnings: ["w"], errors: [], ms: 12.4 })).toMatch(/^x\s+5 vox {2}bbox empty\s+12 ms {2}1 warn$/);
  });
});

describe("building the example recipes (in-process core host, no browser)", () => {
  const out = join(tmp, "out");

  test("house / tree / courtyard: scenes, variants, meshes, manifest, carried anchors", async () => {
    const recipes = await loadRecipes([join(ROOT, "recipes/examples")]);
    expect(recipes.map((r) => r.name).sort()).toEqual(["courtyard", "house", "tree"]);
    const host = coreHost();
    const r = await buildRecipes(recipes, host, { outDir: out, export: ["glb"] });
    expect(r.ok).toBe(true);
    expect(r.clean).toBe(true); // no warnings: examples build clean under --strict
    const by = Object.fromEntries(r.models.map((m) => [m.name, m]));
    expect(by.house!.voxels).toBeGreaterThan(4000);
    expect(by.house!.notes).toContain("sheet: skipped (no page; run with a browser to render sheets)");
    // slots, anchors, variant
    const house = await readSceneFile(join(out, "house.json"));
    expect(house.version).toBe(2);
    expect(Object.keys(house.slots!)).toEqual(["roof", "wall", "pillar"]);
    expect(house.anchors!.door).toEqual({ x: 20, y: 0, z: 31, dir: "+z", note: "in front of the door, on the platform edge" });
    const gold = await readSceneFile(join(out, "house@gold.json"));
    expect(gold.data).toBe(house.data);
    expect(gold.palette[gold.slots!.roof!.shades.base!.index]).toBe("#e8b830");
    // every color the roof op used is a roof slot entry (slot refs + shade factors line up)
    const e = new Editor(); e.load(house);
    const roofIdx = new Set(Object.values(house.slots!.roof!.shades).map((s) => s.index));
    const top = e.info().colorsUsed.filter((c) => /^#(3a9ab0|2b7282|47bcd7|52dbfa|1a454f|328497)$/.test(c.hex));
    expect(top.length).toBe(6);
    expect(top.every((c) => roofIdx.has(c.index))).toBe(true);
    // meshes for the model and each variant
    for (const f of ["house.glb", "house@gold.glb", "tree.glb", "tree@autumn.glb", "courtyard.glb"]) expect(existsSync(join(out, f))).toBe(true);
    // composition: the courtyard carries both houses' anchors and has a red roof
    expect(by.courtyard!.anchors.hall_door).toEqual({ x: 47, y: 1, z: 26, dir: "+z", note: "in front of the door, on the platform edge" });
    expect(by.courtyard!.anchors.west_door!.dir).toBe("+x");
    const court = new Editor(); court.load(await readSceneFile(join(out, "courtyard.json")));
    expect(court.info().colorsUsed.some((c) => c.hex === "#c04030")).toBe(true);
    // manifest
    const manifest = await Bun.file(join(out, "manifest.json")).json();
    expect(manifest.house.files).toMatchObject({ scene: "house.json", variants: { gold: "house@gold.json" }, meshes: { glb: "house.glb", "gold:glb": "house@gold.glb" } });
    expect(manifest.courtyard.slots.roof.base).toBe("#3a9ab0");
    // the last model built stays loaded
    expect(host.editor.grid.count).toBe(by[recipes.at(-1)!.name]!.voxels);
  });

  test("errors are per recipe; stamp cycles and unknown recipes are reported", async () => {
    const dir = join(tmp, "bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "c.js"), `export default [
      { name: "a", ops: [{ op: "stamp", recipe: "b" }] },
      { name: "b", ops: [{ op: "stamp", recipe: "a" }] },
      { name: "c", ops: [{ op: "stamp", recipe: "zzz" }] },
      { name: "d", ops: [{ op: "box", min: [0,0,0], max: [40,0,0], color: "#ffffff" }] },
    ];`);
    const r = await buildRecipes(await loadRecipes([dir]), coreHost(), { outDir: join(dir, "out") });
    expect(r.ok).toBe(false);
    const by = Object.fromEntries(r.models.map((m) => [m.name, m]));
    expect(by.a!.errors[0]).toMatch(/stamp cycle: a → b → a/);
    expect(by.c!.errors[0]).toMatch(/no recipe with that name/);
    expect(by.d!.errors).toEqual([]);
    expect(by.d!.warnings[0]).toMatch(/^run: op 0 \(box\): \d+ cells clipped/);
  });

  test("CLI: --no-sheet --strict on the examples exits 0 and prints one line per model", () => {
    const p = Bun.spawnSync([process.execPath, "scripts/build.ts", "recipes/examples", "--no-sheet", "--strict", "--out", join(tmp, "cli")], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    const stdout = p.stdout.toString();
    expect(p.exitCode).toBe(0);
    expect(stdout).toMatch(/^house\s+\d+ vox {2}bbox 3,0,8\.\.36,24,32/m);
    expect(stdout).toContain("3 model(s), 0 failed, 0 warning(s)");
    const bad = Bun.spawnSync([process.execPath, "scripts/build.ts", "recipes/examples", "--no-sheet", "--only", "nope", "--out", join(tmp, "cli")], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(bad.exitCode).toBe(1);
  });
});
