import { describe, expect, test } from "bun:test";
import { DEFAULT_COLORS, Palette, hexToRgb, normalizeHex, rgbToHex, clampByte, MAX_COLORS } from "../src/core/Palette";

describe("color helpers", () => {
  test("hex <-> rgb", () => {
    expect(hexToRgb("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb("FF8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb("#fff")).toBeNull();
    expect(hexToRgb("nope")).toBeNull();
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe("#ff8000");
    expect(rgbToHex({ r: 300, g: -5, b: 1.6 })).toBe("#ff0002");
    expect(clampByte(NaN)).toBe(0);
    expect(normalizeHex("ABCDEF")).toBe("#abcdef");
  });
});

describe("Palette", () => {
  test("defaults to 32 unique colors", () => {
    const p = new Palette();
    expect(p.length).toBe(32);
    expect(new Set(DEFAULT_COLORS).size).toBe(32);
    expect(p.get(0)).toBe("#ffffff");
  });

  test("add and update notify listeners", () => {
    const p = new Palette(["#000000"]);
    let n = 0;
    p.onChange.add(() => n++);
    expect(p.add("#123456")).toBe(1);
    p.update(0, "#fff000");
    expect(p.all()).toEqual(["#fff000", "#123456"]);
    expect(n).toBe(2);
    expect(() => p.add("bad")).toThrow();
    expect(() => p.update(5, "#000000")).toThrow(RangeError);
    expect(p.get(9)).toBeUndefined();
  });

  test("caps at MAX_COLORS", () => {
    const p = new Palette([]);
    for (let i = 0; i < MAX_COLORS; i++) p.add("#000000");
    expect(() => p.add("#000000")).toThrow("palette full");
  });

  test("cell mapping round-trips", () => {
    expect(Palette.toCell(0)).toBe(1);
    expect(Palette.fromCell(Palette.toCell(31))).toBe(31);
  });
});

describe("Palette.resolve", () => {
  test("indices pass through, hex matches or appends, full palette picks nearest", () => {
    const p = new Palette(["#000000", "#ff0000"]);
    expect(p.resolve(1)).toBe(1);
    expect(() => p.resolve(2)).toThrow();
    expect(p.resolve("#FF0000")).toBe(1);
    expect(p.resolve("#00ff00")).toBe(2);
    expect(() => p.resolve("red")).toThrow(/invalid color/);
    const full = new Palette(Array.from({ length: MAX_COLORS }, (_, i) => rgbToHex({ r: i, g: 0, b: 0 })));
    expect(full.resolve("#0a0001")).toBe(10);
  });

  test("replaceAll swaps the whole list", () => {
    const p = new Palette(["#000000"]);
    let n = 0;
    p.onChange.add(() => n++);
    p.replaceAll(["#111111", "#222222"]);
    expect(p.all()).toEqual(["#111111", "#222222"]);
    expect(n).toBe(1);
    expect(() => p.replaceAll([])).toThrow();
  });
});
