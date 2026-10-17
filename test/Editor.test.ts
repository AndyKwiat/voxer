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

describe("Editor batch ops and scenes", () => {
  test("run applies a batch as one undo step and one voxels event", () => {
    const ed = new Editor(new VoxelGrid(8), new Palette(["#000000", "#ffffff"]));
    const events: number[] = [];
    ed.on("voxels", (e) => events.push(e.length));
    expect(ed.run([{ op: "box", min: [0, 0, 0], max: [1, 1, 1], color: "#ff0000" }, { op: "set", voxels: [[5, 5, 5, 1]] }])).toBe(9);
    expect(ed.palette.length).toBe(3); // hex added
    expect(ed.grid.get(0, 0, 0)).toBe(Palette.toCell(2));
    expect(events).toEqual([9]);
    expect(ed.info().bbox).toEqual({ min: { x: 0, y: 0, z: 0 }, max: { x: 5, y: 5, z: 5 } });
    ed.undo();
    expect(ed.grid.count).toBe(0);
  });

  test("a malformed op leaves the grid untouched", () => {
    const ed = new Editor(new VoxelGrid(8));
    expect(() => ed.run([{ op: "box", min: [0, 0, 0], max: [1, 1, 1], color: 0 }, { op: "box", min: [0, 0, 0], max: [1, 1, 1], color: 999 }])).toThrow();
    expect(ed.grid.count).toBe(0);
  });

  test("serialize/load round-trips, can change size, emits reset and clears history", () => {
    const ed = new Editor(new VoxelGrid(8), new Palette(["#000000", "#ffffff"]));
    ed.run([{ op: "box", min: [1, 1, 1], max: [3, 2, 6], color: 1 }]);
    const saved = ed.serialize();
    const other = new Editor(new VoxelGrid(16));
    let resets = 0;
    other.on("reset", () => resets++);
    other.setColor(20);
    other.load(saved);
    expect(resets).toBe(1);
    expect(other.grid.size).toBe(8);
    expect(other.grid.count).toBe(ed.grid.count);
    expect(other.grid.data).toEqual(ed.grid.data);
    expect(other.palette.all()).toEqual(["#000000", "#ffffff"]);
    expect(other.color).toBe(0);
    expect(other.history.canUndo).toBe(false);
    other.newScene(32);
    expect(other.grid.size).toBe(32);
    expect(other.grid.count).toBe(0);
  });
});

describe("Editor slots and anchors", () => {
  const house = () => {
    const ed = new Editor(new VoxelGrid(16), new Palette(["#000000", "#ffffff"]));
    const roof = ed.defineSlot("roof", "#3a9ab0", { dark: 0.74 });
    const wall = ed.defineSlot("wall", "#f6e8c8");
    ed.run([
      { op: "box", min: [2, 0, 2], max: [9, 4, 9], color: wall.colors.base! },
      { op: "box", min: [2, 5, 2], max: [9, 5, 9], color: roof.colors.base! },
      { op: "box", min: [2, 6, 2], max: [9, 6, 9], color: roof.colors.dark! },
    ]);
    ed.setAnchor("door", { x: 5, y: 0, z: 10, dir: "+z", note: "outside the front door" });
    return ed;
  };

  test("defineSlot adds ramp colors that draw ops paint with; recolorSlot recolors those voxels", () => {
    const ed = house();
    expect(ed.palette.length).toBe(5);
    expect(ed.listSlots().roof).toEqual({ base: "#3a9ab0", colors: { base: "#3a9ab0", dark: "#2b7282" }, factors: { base: 1, dark: 0.74 } });
    let palEvents = 0, meta = 0;
    ed.on("palette", () => palEvents++);
    ed.on("meta", () => meta++);
    ed.recolorSlot("roof", "#e8b830");
    expect(palEvents).toBe(1);
    expect(meta).toBe(1);
    const roofTop = ed.grid.get(4, 6, 4);
    expect(ed.palette.get(Palette.fromCell(roofTop))).toBe("#ac8824");
    expect(ed.info().slots.roof!.colors).toEqual({ base: "#e8b830", dark: "#ac8824" });
    ed.adoptSlot("trim", ["#ffffff"]);
    expect(Object.keys(ed.slots)).toEqual(["roof", "wall", "trim"]);
  });

  test("serialize/load round-trips slots + anchors as version 2", () => {
    const ed = house();
    const saved = JSON.parse(JSON.stringify(ed.serialize()));
    expect(saved.version).toBe(2);
    expect(saved.anchors).toEqual({ door: { x: 5, y: 0, z: 10, dir: "+z", note: "outside the front door" } });
    expect(Object.keys(saved.slots)).toEqual(["roof", "wall"]);
    const other = new Editor();
    other.load(saved);
    expect(other.serialize()).toEqual(saved);
    expect(other.slots).toEqual(ed.slots);
    expect(other.anchors).toEqual(ed.anchors);
    other.recolorSlot("wall", "#a0a0a0"); // loaded slots are live
    expect(other.palette.get(Palette.fromCell(other.grid.get(2, 0, 2)))).toBe("#a0a0a0");
  });

  test("version 1 scenes without slots/anchors still load, and plain scenes still save as version 1", () => {
    const v1 = { version: 1 as const, size: 2, palette: ["#000000", "#ff0000"], data: "AAECAgAF" }; // 1 empty, 2 red, 5 empty
    const ed = house();
    ed.load(v1);
    expect(ed.grid.count).toBe(2);
    expect(ed.slots).toEqual({});
    expect(ed.anchors).toEqual({});
    expect(ed.serialize()).toEqual(v1);
    expect(() => ed.load({ ...v1, version: 3 as never })).toThrow(/version/);
    expect(() => ed.load({ ...v1, version: 2, slots: { roof: { base: "#ffffff", shades: { base: { index: 9, factor: 1 } } } } })).toThrow();
    expect(ed.grid.count).toBe(2); // a bad scene doesn't half-load
  });

  test("makeVariant returns a recolored scene without touching the editor", () => {
    const ed = house();
    const before = ed.serialize();
    let events = 0;
    ed.on("palette", () => events++);
    ed.on("meta", () => events++);
    const v = ed.makeVariant({ roof: "#e8b830", wall: "#c0a080" });
    expect(ed.serialize()).toEqual(before);
    expect(events).toBe(0);
    expect(v.data).toBe(before.data);
    expect(v.anchors).toEqual(before.anchors!);
    const other = new Editor();
    other.load(v);
    expect(other.palette.get(Palette.fromCell(other.grid.get(4, 6, 4)))).toBe("#ac8824");
    expect(other.palette.get(Palette.fromCell(other.grid.get(2, 0, 2)))).toBe("#c0a080");
    expect(() => ed.makeVariant({ roof: "yellow" })).toThrow();
  });

  test("anchors: set/remove, carried by translate (undoably), cleared by newScene", () => {
    const ed = house();
    expect(() => ed.setAnchor("door", { x: 1.5, y: 0, z: 0 })).toThrow();
    ed.setAnchor("roof_top", { x: 5, y: 7, z: 5 });
    ed.run([{ op: "translate", offset: [3, 0, 0] }]);
    expect(ed.anchors.door).toMatchObject({ x: 8, y: 0, z: 10, dir: "+z" });
    expect(ed.anchors.roof_top).toEqual({ x: 8, y: 7, z: 5 });
    expect(ed.run([{ op: "mirror", axis: "x", source: "upper" }])).toBeGreaterThan(0);
    expect(ed.anchors.roof_top).toEqual({ x: 8, y: 7, z: 5 });
    ed.undo(); // mirror
    ed.undo(); // translate
    expect(ed.anchors.door).toMatchObject({ x: 5, z: 10 });
    expect(ed.anchors.roof_top).toEqual({ x: 5, y: 7, z: 5 });
    ed.redo();
    expect(ed.anchors.roof_top).toEqual({ x: 8, y: 7, z: 5 });
    expect(ed.removeAnchor("roof_top")).toBe(true);
    expect(ed.removeAnchor("roof_top")).toBe(false);
    ed.newScene();
    expect(ed.anchors).toEqual({});
    expect(ed.slots).toEqual({});
  });

  test("slots whose palette entries disappear are dropped", () => {
    const ed = house();
    ed.palette.replaceAll(["#000000", "#ffffff", "#3a9ab0", "#2b7282"]); // wall's entry (index 4) is gone
    expect(Object.keys(ed.slots)).toEqual(["roof"]);
  });
});
