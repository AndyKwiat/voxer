import { describe, expect, test } from "bun:test";
import { DEFAULT_COLORS } from "../src/core/Palette";
import type { SceneData } from "../src/core/Scene";
import {
  deriveRamp, fitFactor, parseSlots, planAdoptSlot, planDefineSlot, recolorSlot, shade, uniqueHex, variantScene,
} from "../src/core/Slots";

const ROOF = { dark: 0.74, light: 1.22, cap: 1.42, ridge: 0.45, side: 0.86 };

describe("ramp math", () => {
  test("shade matches the game's multiplicative ramps (rounded, clamped)", () => {
    // Values from waldo/voxel/models/recipes/colors.js roofRamp("#3a9ab0") / roofRamp("#e8b830").
    expect(deriveRamp("#3a9ab0", ROOF)).toEqual({ base: "#3a9ab0", dark: "#2b7282", light: "#47bcd7", cap: "#52dbfa", ridge: "#1a454f", side: "#328497" });
    expect(deriveRamp("#E8B830", ROOF)).toEqual({ base: "#e8b830", dark: "#ac8824", light: "#ffe03b", cap: "#ffff44", ridge: "#685316", side: "#c89e29" });
    expect(shade("#000000", 2)).toBe("#000000");
    expect(() => shade("nope", 1)).toThrow();
  });

  test("fitFactor recovers the factor of a shade", () => {
    expect(fitFactor("#2b7282", "#3a9ab0")).toBeCloseTo(0.74, 2);
    expect(fitFactor("#3a9ab0", "#3a9ab0")).toBe(1);
    expect(fitFactor("#123456", "#000000")).toBe(1); // black base: anything goes
  });

  test("uniqueHex nudges a taken color by the smallest step", () => {
    expect(uniqueHex("#808080", new Set())).toBe("#808080");
    expect(uniqueHex("#808080", new Set(["#808080"]))).toBe("#808180");
    expect(uniqueHex("#ffffff", new Set(["#ffffff"]))).toBe("#fffeff");
  });
});

describe("slot planning", () => {
  test("define appends a unique ramp; redefinition reuses entries by shade name", () => {
    const pal = ["#000000", "#2b7282"]; // a color equal to the dark shade already exists
    const a = planDefineSlot(pal, {}, "roof", "#3a9ab0", { dark: 0.74, light: 1.22 });
    expect(a.slot.shades).toEqual({ base: { index: 2, factor: 1 }, dark: { index: 3, factor: 0.74 }, light: { index: 4, factor: 1.22 } });
    expect(a.palette.slice(0, 2)).toEqual(pal);
    expect(a.palette[2]).toBe("#3a9ab0");
    expect(a.palette[3]).not.toBe("#2b7282"); // nudged so painting with it hits the slot's entry
    expect(new Set(a.palette).size).toBe(a.palette.length);
    expect(a.palette[4]).toBe("#47bcd7");

    const b = planDefineSlot(a.palette, { roof: a.slot }, "roof", "#ff0000", { dark: 0.5, edge: "#330000" });
    expect(b.slot.shades.base!.index).toBe(2);
    expect(b.slot.shades.dark!.index).toBe(3);
    expect(b.slot.shades.edge).toEqual({ index: 5, factor: 0.2 });
    expect(b.palette[5]).toBe("#330000"); // explicit shades keep their color
    expect(b.palette[3]).toBe("#800000");
  });

  test("define rejects bad input and a full palette", () => {
    expect(() => planDefineSlot([], {}, "1bad", "#ffffff")).toThrow();
    expect(() => planDefineSlot([], {}, "roof", "red")).toThrow();
    expect(() => planDefineSlot([], {}, "roof", "#ffffff", { dark: -1 })).toThrow();
    expect(() => planDefineSlot(Array(254).fill("#000000"), {}, "roof", "#ffffff", { dark: 0.5 })).toThrow(/palette full/);
  });

  test("adopt takes existing entries and fits factors; entries can't be shared", () => {
    const pal = [...DEFAULT_COLORS, "#3a9ab0", "#2b7282"];
    const s = planAdoptSlot(pal, {}, "roof", ["#3a9ab0", 33], ["base", "dark"]);
    expect(s).toEqual({ base: "#3a9ab0", shades: { base: { index: 32, factor: 1 }, dark: { index: 33, factor: 0.739 } } });
    expect(() => planAdoptSlot(pal, { roof: s }, "wall", ["#2b7282"])).toThrow(/another slot/);
    expect(() => planAdoptSlot(pal, {}, "x", ["#123456"])).toThrow(/not in the palette/);
    expect(planAdoptSlot(pal, {}, "x", [0, 1]).shades.shade1).toEqual({ index: 1, factor: 0.753 });
  });

  test("recolor re-derives each shade from the new base", () => {
    const a = planDefineSlot(["#000000"], {}, "roof", "#3a9ab0", ROOF);
    const r = recolorSlot(a.palette, { roof: a.slot }, "roof", "#e8b830");
    expect(r.slot.base).toBe("#e8b830");
    expect(r.palette).toEqual(["#000000", "#e8b830", "#ac8824", "#ffe03b", "#ffff44", "#685316", "#c89e29"]);
    expect(() => recolorSlot(a.palette, { roof: a.slot }, "wall", "#ffffff")).toThrow(/no slot "wall"/);
  });
});

describe("variants and parsing", () => {
  const a = planDefineSlot(["#000000"], {}, "roof", "#3a9ab0", { dark: 0.74 });
  const scene: SceneData = { version: 2, size: 2, palette: a.palette, data: "AAg=", slots: { roof: a.slot }, anchors: { door: { x: 1, y: 0, z: 1 } } };

  test("variantScene recolors a copy and leaves the input alone", () => {
    const before = structuredClone(scene);
    const v = variantScene(scene, { roof: "#e8b830" });
    expect(v.palette).toEqual(["#000000", "#e8b830", "#ac8824"]);
    expect(v.slots!.roof!.base).toBe("#e8b830");
    expect(v.data).toBe(scene.data);
    expect(v.anchors).toEqual(scene.anchors!);
    expect(scene).toEqual(before);
    expect(() => variantScene(scene, { nope: "#ffffff" })).toThrow();
    expect(() => variantScene(scene, {})).toThrow();
  });

  test("parseSlots validates indices against the palette", () => {
    expect(parseSlots(undefined, 3)).toEqual({});
    expect(parseSlots(scene.slots, 3)).toEqual(scene.slots!);
    expect(() => parseSlots(scene.slots, 2)).toThrow(/bad palette index/);
    expect(() => parseSlots({ r: { base: "#ffffff", shades: { dark: { index: 0, factor: 1 } } } }, 3)).toThrow(/base/);
    expect(() => parseSlots({ a: { base: "#ffffff", shades: { base: { index: 0, factor: 1 } } }, b: { base: "#ffffff", shades: { base: { index: 0, factor: 1 } } } }, 3)).toThrow(/already/);
  });
});
