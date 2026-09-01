import { describe, expect, test } from "bun:test";
import { History } from "../src/core/History";
import { VoxelGrid, EMPTY } from "../src/core/VoxelGrid";

describe("History", () => {
  test("single edits undo/redo", () => {
    const g = new VoxelGrid(8);
    const h = new History(g);
    expect(h.canUndo).toBe(false);
    h.apply({ x: 1, y: 1, z: 1, before: EMPTY, after: 2 });
    expect(g.get(1, 1, 1)).toBe(2);
    expect(h.undo()!.length).toBe(1);
    expect(g.get(1, 1, 1)).toBe(EMPTY);
    expect(h.canRedo).toBe(true);
    h.redo();
    expect(g.get(1, 1, 1)).toBe(2);
    expect(h.undo()).not.toBeNull();
    expect(h.undo()).toBeNull();
    expect(h.redo()).not.toBeNull();
    expect(h.redo()).toBeNull();
  });

  test("strokes are undone as a unit and in reverse order", () => {
    const g = new VoxelGrid(8);
    const h = new History(g);
    h.beginStroke();
    h.apply({ x: 0, y: 0, z: 0, before: EMPTY, after: 1 });
    h.apply({ x: 0, y: 0, z: 0, before: 1, after: 2 });
    h.apply({ x: 1, y: 0, z: 0, before: EMPTY, after: 3 });
    h.endStroke();
    expect(g.count).toBe(2);
    h.undo();
    expect(g.count).toBe(0);
    expect(g.get(0, 0, 0)).toBe(EMPTY);
    h.redo();
    expect(g.get(0, 0, 0)).toBe(2);
    expect(g.get(1, 0, 0)).toBe(3);
  });

  test("empty stroke records nothing; new edit clears redo", () => {
    const g = new VoxelGrid(8);
    const h = new History(g);
    h.beginStroke();
    h.endStroke();
    expect(h.canUndo).toBe(false);
    h.apply({ x: 0, y: 0, z: 0, before: EMPTY, after: 1 });
    h.undo();
    expect(h.canRedo).toBe(true);
    h.apply({ x: 2, y: 0, z: 0, before: EMPTY, after: 1 });
    expect(h.canRedo).toBe(false);
  });

  test("respects limit", () => {
    const g = new VoxelGrid(8);
    const h = new History(g, 2);
    for (let i = 0; i < 3; i++) h.apply({ x: i, y: 0, z: 0, before: EMPTY, after: 1 });
    expect(h.undo()).not.toBeNull();
    expect(h.undo()).not.toBeNull();
    expect(h.undo()).toBeNull();
    expect(g.get(0, 0, 0)).toBe(1);
  });

  test("clear drops both stacks and any open stroke", () => {
    const g = new VoxelGrid(8);
    const h = new History(g);
    h.apply({ x: 0, y: 0, z: 0, before: EMPTY, after: 1 });
    h.undo();
    h.beginStroke();
    h.apply({ x: 1, y: 0, z: 0, before: EMPTY, after: 1 });
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(g.get(1, 0, 0)).toBe(1); // clear forgets edits, it does not revert them
  });
});
