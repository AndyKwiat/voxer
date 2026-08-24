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

  test("applyTool places with the selected color and records history", () => {
    const ed = new Editor(new VoxelGrid(8));
    const events: number[] = [];
    ed.on("voxels", (e) => events.push(e.length));
    ed.setColor(5);
    ed.beginStroke();
    expect(ed.applyTool(floor(1, 1))).toEqual({ x: 1, y: 0, z: 1, before: EMPTY, after: Palette.toCell(5) });
    expect(ed.applyTool(floor(1, 1))).toBeNull(); // occupied now
    ed.applyTool(top(1, 0, 1));
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
