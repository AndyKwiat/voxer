import { describe, expect, test } from "bun:test";
import { Editor } from "../src/core/Editor";
import { Palette } from "../src/core/Palette";
import type { Hit } from "../src/core/Raycast";
import { VoxelGrid, EMPTY } from "../src/core/VoxelGrid";

const floor = (x: number, z: number): Hit => ({ cell: { x, y: -1, z }, normal: { x: 0, y: 1, z: 0 }, voxel: false, t: 1 });
const top = (x: number, y: number, z: number): Hit => ({ cell: { x, y, z }, normal: { x: 0, y: 1, z: 0 }, voxel: true, t: 1 });

describe("Editor", () => {
  test("tool and color selection emit events and wrap", () => {
    const ed = new Editor(new VoxelGrid(8), new Palette(["#000000", "#ffffff", "#ff0000"]));
    const tools: string[] = [], colors: number[] = [];
    ed.on("tool", (t) => tools.push(t));
    ed.on("color", (c) => colors.push(c));
    ed.setTool("eraser"); ed.setTool("eraser"); ed.nextTool(); ed.nextTool();
    expect(tools).toEqual(["eraser", "paint", "pen"]);
    ed.stepColor(-1); ed.stepColor(1); ed.setColor(99);
    expect(colors).toEqual([2, 0]);
    expect(ed.colorHex).toBe("#000000");
  });

  test("pen stroke locks to the plane most facing the camera", () => {
    const ed = new Editor(new VoxelGrid(8));
    ed.beginStroke({ x: 0.1, y: -0.9, z: 0.2 }); // looking down -> lock the horizontal x-z plane
    expect(ed.strokePlane).toBeNull(); // nothing placed yet
    expect(ed.applyTool(floor(2, 2))).not.toBeNull(); // anchor at (2,0,2)
    expect(ed.strokePlane).toEqual({ axis: "y", value: 0 });
    expect(ed.applyTool(floor(5, 6))).not.toBeNull(); // same y, anywhere in x/z
    expect(ed.applyTool(top(2, 0, 2))).toBeNull(); // (2,1,2) leaves the plane
    expect(ed.previewCell(top(2, 0, 2))).toBeNull(); // and shows no ghost
    ed.endStroke();
    expect(ed.strokePlane).toBeNull();
  });

  test("a stroke started facing a wall locks to that wall's plane", () => {
    const ed = new Editor(new VoxelGrid(8));
    ed.beginStroke({ x: 0.2, y: -0.3, z: 0.93 }); // looking mostly along +z -> lock z
    expect(ed.applyTool(floor(4, 4))).not.toBeNull(); // anchor at (4,0,4)
    expect(ed.strokePlane).toEqual({ axis: "z", value: 4 });
    expect(ed.applyTool(top(4, 0, 4))).not.toBeNull(); // (4,1,4): stacking up stays in z=4
    expect(ed.applyTool(floor(6, 4))).not.toBeNull(); // (6,0,4): sideways stays in z=4
    expect(ed.applyTool(floor(6, 5))).toBeNull(); // z=5 is off the plane
    ed.endStroke();
  });

  test("beginStroke without a view direction locks the horizontal plane", () => {
    const ed = new Editor(new VoxelGrid(8));
    ed.beginStroke();
    ed.applyTool(floor(1, 1));
    expect(ed.strokePlane).toEqual({ axis: "y", value: 0 });
    ed.endStroke();
  });

  test("eraser and paint strokes are not plane-locked", () => {
    const ed = new Editor(new VoxelGrid(8));
    ed.setRaw(1, 0, 1, 1);
    ed.setRaw(4, 3, 6, 1);
    ed.setTool("eraser");
    ed.beginStroke();
    expect(ed.applyTool(top(1, 0, 1))).not.toBeNull();
    expect(ed.applyTool(top(4, 3, 6))).not.toBeNull();
    ed.endStroke();
    expect(ed.grid.count).toBe(0);
  });

  test("applyTool places with the selected color and records history", () => {
    const ed = new Editor(new VoxelGrid(8));
    const events: number[] = [];
    ed.on("voxels", (e) => events.push(e.length));
    ed.setColor(5);
    ed.beginStroke();
    expect(ed.applyTool(floor(1, 1))).toEqual({ x: 1, y: 0, z: 1, before: EMPTY, after: Palette.toCell(5) });
    expect(ed.applyTool(floor(1, 1))).toBeNull(); // occupied now
    ed.applyTool(floor(2, 1)); // same stroke, same y plane
    ed.endStroke();
    expect(ed.grid.count).toBe(2);
    expect(ed.undo()).toBe(true);
    expect(ed.grid.count).toBe(0);
    expect(ed.undo()).toBe(false);
    expect(ed.redo()).toBe(true);
    expect(ed.grid.count).toBe(2);
    expect(events).toEqual([1, 1, 2, 2]);
  });

  test("previewCell follows the tool", () => {
    const ed = new Editor(new VoxelGrid(8));
    expect(ed.previewCell(floor(2, 3))).toEqual({ x: 2, y: 0, z: 3 });
    ed.setTool("eraser");
    expect(ed.previewCell(floor(2, 3))).toBeNull();
    expect(ed.previewCell(null)).toBeNull();
  });

  test("addColor selects the new color; palette edits emit", () => {
    const ed = new Editor(new VoxelGrid(8), new Palette(["#000000"]));
    let n = 0;
    ed.on("palette", () => n++);
    ed.addColor("#123456");
    expect(ed.color).toBe(1);
    ed.palette.update(0, "#ffffff");
    expect(n).toBe(2);
  });
});

describe("Editor scenes", () => {
  const seeded = () => {
    const ed = new Editor(new VoxelGrid(8), new Palette(["#ff0000", "#00ff00"]));
    ed.setRaw(1, 2, 3, Palette.toCell(1));
    ed.setRaw(4, 0, 0, Palette.toCell(0));
    return ed;
  };

  test("saves and reloads a scene into another editor", () => {
    const src = seeded();
    const doc = JSON.parse(JSON.stringify(src.toScene()));
    const dst = new Editor(new VoxelGrid(8));
    dst.loadScene(doc, "castle");
    expect(dst.grid.count).toBe(2);
    expect(dst.grid.get(1, 2, 3)).toBe(Palette.toCell(1));
    expect(dst.palette.all()).toEqual(["#ff0000", "#00ff00"]);
    expect(dst.sceneName).toBe("castle");
    expect(dst.dirty).toBe(false);
  });

  test("load emits one voxels event covering every changed cell and clears history", () => {
    const ed = new Editor(new VoxelGrid(8));
    ed.beginStroke();
    ed.applyTool(floor(0, 0)); // a voxel the loaded scene does not have
    ed.endStroke();
    const batches: number[] = [];
    ed.on("voxels", (e) => batches.push(e.length));
    ed.loadScene(JSON.parse(JSON.stringify(seeded().toScene())), "x");
    expect(batches).toEqual([3]); // 2 added + 1 cleared
    expect(ed.grid.count).toBe(2);
    expect(ed.undo()).toBe(false); // history dropped with the old scene
  });

  test("dirty flag tracks edits and saves", () => {
    const ed = seeded();
    expect(ed.dirty).toBe(true);
    const events: [string | null, boolean][] = [];
    ed.on("scene", (n, d) => events.push([n, d]));
    ed.markSaved("hut");
    expect([ed.sceneName, ed.dirty]).toEqual(["hut", false]);
    ed.beginStroke();
    ed.applyTool(floor(6, 6));
    ed.endStroke();
    expect(ed.dirty).toBe(true);
    ed.palette.add("#123456");
    expect(events).toEqual([["hut", false], ["hut", true]]); // one dirty event, not one per edit
  });

  test("refuses a scene whose grid size does not match", () => {
    const doc = seeded().toScene();
    const ed = new Editor(new VoxelGrid(16));
    expect(() => ed.loadScene(doc, "x")).toThrow(/8³ but this editor holds a 16³/);
  });

  test("carries unknown fields from a loaded file back into the next save", () => {
    const ed = new Editor(new VoxelGrid(8));
    ed.loadScene({ ...JSON.parse(JSON.stringify(seeded().toScene())), camera: { theta: 2 } }, "x");
    expect(ed.toScene()["camera"]).toEqual({ theta: 2 });
  });

  test("keeps the selected color in range when a smaller palette loads", () => {
    const ed = new Editor(new VoxelGrid(8));
    ed.setColor(20);
    ed.loadScene(JSON.parse(JSON.stringify(seeded().toScene())), "x");
    expect(ed.color).toBe(0);
    expect(ed.colorHex).toBe("#ff0000");
  });
});
