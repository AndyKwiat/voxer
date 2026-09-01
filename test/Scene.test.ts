import { describe, expect, test } from "bun:test";
import { Palette } from "../src/core/Palette";
import {
  decodeRuns, decodeScene, encodeRuns, encodeScene, SceneFormatError, SCENE_FORMAT, SCENE_VERSION,
} from "../src/core/Scene";
import { VoxelGrid } from "../src/core/VoxelGrid";

const grid8 = () => {
  const g = new VoxelGrid(8);
  g.set(0, 0, 0, 1);
  g.set(3, 2, 1, 4);
  g.set(7, 7, 7, 2);
  return g;
};
const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffffff"];

describe("RLE", () => {
  test("round-trips", () => {
    const cells = new Uint8Array([0, 0, 0, 5, 5, 1, 0, 0]);
    expect(encodeRuns(cells)).toEqual([3, 0, 2, 5, 1, 1, 2, 0]);
    expect(decodeRuns(encodeRuns(cells), cells.length)).toEqual(cells);
  });

  test("an empty grid is two numbers", () => {
    expect(encodeRuns(new Uint8Array(32768))).toEqual([32768, 0]);
  });

  test("rejects runs that do not cover the grid exactly", () => {
    expect(() => decodeRuns([2, 1], 8)).toThrow(SceneFormatError);
    expect(() => decodeRuns([9, 1], 8)).toThrow(SceneFormatError);
    expect(() => decodeRuns([2, 1, 3], 8)).toThrow(SceneFormatError);
    expect(() => decodeRuns([0, 1, 8, 0], 8)).toThrow(SceneFormatError);
    expect(() => decodeRuns([8, 300], 8)).toThrow(SceneFormatError);
  });
});

describe("scene documents", () => {
  test("encode → decode preserves grid and palette", () => {
    const doc = encodeScene(grid8(), colors);
    expect(doc.format).toBe(SCENE_FORMAT);
    expect(doc.version).toBe(SCENE_VERSION);
    expect(doc.size).toBe(8);
    const back = decodeScene(JSON.parse(JSON.stringify(doc)));
    expect(back.size).toBe(8);
    expect(back.palette).toEqual(colors);
    expect(back.cells).toEqual(grid8().data);
    expect(back.extra).toEqual({});
  });

  test("unknown fields from a newer build survive a round trip", () => {
    const doc = { ...encodeScene(grid8(), colors), camera: { theta: 1 }, layers: ["a"] };
    const back = decodeScene(doc);
    expect(back.extra).toEqual({ camera: { theta: 1 }, layers: ["a"] });
    // and are written back out when the same editor saves again
    const again = encodeScene(grid8(), colors, back.extra);
    expect(again["camera"]).toEqual({ theta: 1 });
    expect(again.format).toBe(SCENE_FORMAT); // known fields still win
  });

  test("refuses a file from a newer version, with a readable message", () => {
    const doc = { ...encodeScene(grid8(), colors), version: SCENE_VERSION + 1 };
    expect(() => decodeScene(doc)).toThrow(/newer version of Voxer/);
  });

  test("rejects junk", () => {
    expect(() => decodeScene(null)).toThrow(SceneFormatError);
    expect(() => decodeScene([])).toThrow(SceneFormatError);
    expect(() => decodeScene({ format: "something-else", version: 1 })).toThrow(/not a Voxer scene/);
    expect(() => decodeScene({ ...encodeScene(grid8(), colors), version: 0 })).toThrow(/bad scene version/);
    expect(() => decodeScene({ ...encodeScene(grid8(), colors), size: 9999 })).toThrow(/bad grid size/);
    expect(() => decodeScene({ ...encodeScene(grid8(), colors), palette: [] })).toThrow(/palette/);
    expect(() => decodeScene({ ...encodeScene(grid8(), colors), palette: ["nope"] })).toThrow(/bad palette color/);
  });

  test("rejects an unknown voxel encoding instead of guessing", () => {
    const doc = { ...encodeScene(grid8(), colors), voxels: { encoding: "rle-v2", runs: [512, 0] } };
    expect(() => decodeScene(doc)).toThrow(/unknown voxel encoding/);
  });

  test("rejects cells pointing past the palette", () => {
    const g = new VoxelGrid(8);
    g.set(0, 0, 0, Palette.toCell(9));
    expect(() => decodeScene(encodeScene(g, colors))).toThrow(/palette has 4/);
  });
});
