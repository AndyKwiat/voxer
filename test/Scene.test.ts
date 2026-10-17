import { describe, expect, test } from "bun:test";
import { decodeCells, encodeCells } from "../src/core/Scene";

describe("Scene cell encoding", () => {
  test("round-trips sparse and dense data", () => {
    const empty = new Uint8Array(32 ** 3);
    expect(encodeCells(empty).length).toBeLessThan(16);
    expect(decodeCells(encodeCells(empty), empty.length)).toEqual(empty);
    const noisy = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7919) % 256);
    expect(decodeCells(encodeCells(noisy), noisy.length)).toEqual(noisy);
    const big = new Uint8Array(256 ** 3);
    big[123456] = 9;
    expect(decodeCells(encodeCells(big), big.length)).toEqual(big);
  });

  test("rejects bad lengths", () => {
    const d = encodeCells(new Uint8Array(10));
    expect(() => decodeCells(d, 11)).toThrow();
    expect(() => decodeCells(d, 9)).toThrow();
  });
});
