import { describe, expect, test } from "bun:test";
import { makeGridLines } from "../src/render/GridLines";

describe("makeGridLines", () => {
  test("produces floor + two walls, split into short segments", () => {
    const g = makeGridLines(32);
    expect(g.children.length).toBe(2);
    const total = g.children.reduce((n, c) => n + (c as any).geometry.attributes.position.count, 0);
    // 33 lines * 6 directions, each 32 long -> 2 pieces of 16 -> 2 verts each
    expect(total).toBe(33 * 6 * 2 * 2);
    for (const c of g.children) {
      const p = (c as any).geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < p.length; i += 6) {
        const len = Math.hypot(p[i + 3]! - p[i]!, p[i + 4]! - p[i + 1]!, p[i + 5]! - p[i + 2]!);
        expect(len).toBeLessThanOrEqual(16);
        expect(len).toBeGreaterThan(0);
      }
    }
  });
});
