import { describe, expect, test } from "bun:test";
import { anchorsShown, axisMarker, frameWithAnchors } from "../src/render/AnchorOverlay";
import { AXIS_VIEW_DEFS, type Box3 } from "../src/render/Views";

const box: Box3 = { min: { x: 2, y: 0, z: 2 }, max: { x: 10, y: 8, z: 10 } };

describe("AnchorOverlay (pure parts)", () => {
  test("anchors are shown by default only when there are some", () => {
    expect(anchorsShown(undefined, {})).toBe(false);
    expect(anchorsShown(undefined, { a: { x: 0, y: 0, z: 0 } })).toBe(true);
    expect(anchorsShown(false, { a: { x: 0, y: 0, z: 0 } })).toBe(false);
  });

  test("frameWithAnchors grows the content box to include anchor cells", () => {
    expect(frameWithAnchors(box, { door: { x: 5, y: 0, z: 13 } })).toEqual({ min: { x: 2, y: 0, z: 2 }, max: { x: 10, y: 8, z: 14 } });
    expect(frameWithAnchors(box, {})).toEqual(box);
    expect(frameWithAnchors(box, { door: { x: 5, y: 0, z: 13, dir: "+z" }, low: { x: 0, y: 1, z: 3, dir: "-y" } })).toEqual({ min: { x: 0, y: -1, z: 2 }, max: { x: 10, y: 8, z: 16 } });
  });

  test("axisMarker: cell rect, in-plane arrow, and facing for dir along the view axis", () => {
    const door = { x: 5, y: 0, z: 10, dir: "+z" as const };
    const front = axisMarker(AXIS_VIEW_DEFS.front, box, 32, 360, door);
    expect(front.arrow).toBeNull();
    expect(front.facing).toBe("toward");
    expect(front.rect.w).toBeCloseTo(front.rect.h);
    expect(axisMarker(AXIS_VIEW_DEFS.back, box, 32, 360, door).facing).toBe("away");
    expect(axisMarker(AXIS_VIEW_DEFS.top, box, 32, 360, door).arrow).toEqual({ dx: 0, dy: 1 }); // front is at the bottom of the top view
    expect(axisMarker(AXIS_VIEW_DEFS.left, box, 32, 360, door).arrow).toEqual({ dx: 1, dy: 0 });
    // A cell further right in the front view is further right on screen.
    const r2 = axisMarker(AXIS_VIEW_DEFS.front, box, 32, 360, { ...door, x: 6 }).rect;
    expect(r2.x).toBeCloseTo(front.rect.x + front.rect.w);
  });
});
