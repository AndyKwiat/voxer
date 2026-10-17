import { describe, expect, test } from "bun:test";
import { AXIS_VIEW_DEFS, AXIS_VIEWS, isoCamera, labelStep, orthoFrame, toScreen } from "../src/render/Views";

const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});

describe("Views", () => {
  test("declared screen-right axis matches forward × up for every axis view", () => {
    for (const n of AXIS_VIEWS) {
      const v = AXIS_VIEW_DEFS[n];
      const r = cross(v.forward, v.up);
      expect(r[v.right.axis]).toBe(v.right.sign);
      expect(v.up[v.screenUp.axis]).toBe(v.screenUp.sign);
    }
  });

  test("ortho frame is square around the box; toScreen maps box corners inside the picture", () => {
    const box = { min: { x: 4, y: 0, z: 2 }, max: { x: 12, y: 4, z: 6 } };
    const f = orthoFrame(AXIS_VIEW_DEFS.front, box);
    expect(f.cu).toBe(8);
    expect(f.cv).toBe(2);
    expect(f.extent).toBe(10); // 8 wide + 1 cell margin each side
    expect(toScreen(f, 100, 4, 4)).toEqual({ sx: 10, sy: 30 }); // left/top of box
    const r = orthoFrame(AXIS_VIEW_DEFS.right, box); // right view: +z points left on screen
    expect(toScreen(r, 100, 6, 2).sx).toBeLessThan(toScreen(r, 100, 2, 2).sx);
    const t = orthoFrame(AXIS_VIEW_DEFS.top, box); // top view: larger z is lower on screen
    expect(toScreen(t, 100, 8, 6).sy).toBeGreaterThan(toScreen(t, 100, 8, 2).sy);
  });

  test("labelStep picks a readable spacing", () => {
    expect(labelStep(30)).toBe(1);
    expect(labelStep(10)).toBe(4);
    expect(labelStep(1.5)).toBe(16);
  });

  test("iso camera sits outside the box looking at its center", () => {
    const { position, target } = isoCamera("iso", { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 8, z: 8 } });
    expect(target).toEqual({ x: 4, y: 4, z: 4 });
    expect(position.x).toBeGreaterThan(8);
    expect(position.z).toBeGreaterThan(8);
  });
});

test("orthoFrame slides inside the grid when it fits", () => {
  const box = { min: { x: 4, y: 0, z: 2 }, max: { x: 12, y: 4, z: 6 } };
  const f = orthoFrame(AXIS_VIEW_DEFS.front, box, 32);
  expect(f.cv).toBe(5); // window [0,10] instead of [-3,7]
  expect(f.cu).toBe(8);
  expect(orthoFrame(AXIS_VIEW_DEFS.front, box, 8).cv).toBe(2); // bigger than grid: untouched
});
