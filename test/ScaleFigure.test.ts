import { describe, expect, test } from "bun:test";
import { figureSpec, unionBox } from "../src/render/ScaleFigure";

const box = (min: [number, number, number], max: [number, number, number]) => ({
  min: { x: min[0], y: min[1], z: min[2] },
  max: { x: max[0], y: max[1], z: max[2] },
});

describe("scale figure", () => {
  test("is height cells tall, stands on y=0, at the front-left corner outside the content", () => {
    const f = figureSpec(box([10, 0, 10], [20, 12, 20]), 8, 32);
    expect(f.height).toBe(8);
    expect(f.box.min.y).toBe(0);
    expect(f.box.max.y).toBe(8);
    expect(f.box.max.x).toBeLessThanOrEqual(9); // one cell gap left of x=10
    expect(f.box.min.z).toBe(21); // one cell gap in front of z=20
    expect(f.parts.map((p) => p.color)).toEqual(["#00ffff", "#ff00ff", "#ffff00"]);
    // Parts stack without gaps: legs → torso → head.
    expect(f.parts[0]!.min.y).toBe(0);
    expect(f.parts[0]!.max.y).toBe(f.parts[1]!.min.y);
    expect(f.parts[1]!.max.y).toBe(f.parts[2]!.min.y);
    expect(f.parts[2]!.max.y).toBe(8);
    for (const p of f.parts) {
      expect(p.min.x).toBeGreaterThanOrEqual(f.box.min.x);
      expect(p.max.x).toBeLessThanOrEqual(f.box.max.x);
    }
  });

  test("flips to +x / -z when the grid has no room on the preferred side", () => {
    const f = figureSpec(box([0, 0, 4], [10, 5, 32]), 8, 32);
    expect(f.box.min.x).toBe(11); // right of the content
    expect(f.box.max.z).toBeCloseTo(3); // one cell behind z=4
    expect(f.box.min.z).toBeGreaterThanOrEqual(0);
  });

  test("stays front-left (outside the grid) when neither side has room", () => {
    const f = figureSpec(box([0, 0, 0], [32, 5, 32]), 8, 32);
    expect(f.box.max.x).toBe(-1);
    expect(f.box.min.z).toBe(33);
  });

  test("clamps silly heights; unionBox", () => {
    expect(figureSpec(box([0, 0, 0], [1, 1, 1]), 0).height).toBe(1);
    expect(figureSpec(box([0, 0, 0], [1, 1, 1]), NaN).height).toBe(8);
    expect(unionBox(box([0, 0, 0], [2, 2, 2]), box([-3, 1, 1], [1, 9, 5]))).toEqual(box([-3, 0, 0], [2, 9, 5]));
  });
});
