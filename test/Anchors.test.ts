import { describe, expect, test } from "bun:test";
import { anchorMoves, checkAnchor, dirVector, parseAnchors } from "../src/core/Anchors";

describe("anchors", () => {
  test("checkAnchor validates and normalizes", () => {
    expect(checkAnchor("door", { x: 1, y: 0, z: -3, dir: "+z", note: "front door", extra: 1 } as never)).toEqual({ x: 1, y: 0, z: -3, dir: "+z", note: "front door" });
    expect(checkAnchor("a", { x: 0, y: 0, z: 0, note: "" })).toEqual({ x: 0, y: 0, z: 0 });
    expect(() => checkAnchor("a", { x: 0.5, y: 0, z: 0 })).toThrow();
    expect(() => checkAnchor("a", { x: 0, y: 0, z: 0, dir: "up" as never })).toThrow(/dir/);
    expect(() => parseAnchors({ "1x": { x: 0, y: 0, z: 0 } })).toThrow(/name/);
    expect(parseAnchors(undefined)).toEqual({});
  });

  test("dirVector", () => {
    expect(dirVector("-x")).toEqual({ x: -1, y: 0, z: 0 });
    expect(dirVector("+y")).toEqual({ x: 0, y: 1, z: 0 });
  });

  test("only a moving translate moves anchors (all, or those inside its box)", () => {
    const a = { door: { x: 5, y: 0, z: 9, dir: "+z" as const }, top: { x: 5, y: 12, z: 5 } };
    expect(anchorMoves(a, [{ op: "mirror", axis: "x" }, { op: "clear" }, { op: "box", min: [0, 0, 0], max: [1, 1, 1] }])).toEqual([]);
    expect(anchorMoves(a, [{ op: "translate", offset: [1, 0, 0], copy: true }])).toEqual([]);
    expect(anchorMoves(a, [{ op: "translate", offset: [1, 0, 0] }, { op: "translate", offset: { x: 0, y: 2, z: 0 } }])).toEqual([
      { name: "door", from: a.door, to: { x: 6, y: 2, z: 9, dir: "+z" } },
      { name: "top", from: a.top, to: { x: 6, y: 14, z: 5 } },
    ]);
    expect(anchorMoves(a, [{ op: "translate", offset: [0, -1, 0], min: [0, 10, 0], max: [9, 15, 9] }]).map((m) => m.name)).toEqual(["top"]);
  });
});
