import { describe, expect, test } from "bun:test";
import { degrade, degradedNote, snapshotWithRetry, toPageParams } from "../mcp/snapshot";

const timeout = () => Promise.reject(new Error('"snapshot" timed out after 20000 ms'));

describe("MCP snapshot retries", () => {
  test("toPageParams folds figure + figure_height into figure: height", () => {
    expect(toPageParams({ views: ["front"] })).toEqual({ views: ["front"] });
    expect(toPageParams({ figure: true })).toEqual({ figure: 8 });
    expect(toPageParams({ figure: true, figure_height: 12 })).toEqual({ figure: 12 });
    expect(toPageParams({ figure_height: 5 })).toEqual({ figure: 5 });
    expect(toPageParams({ figure: false, figure_height: 5 })).toEqual({ figure: false });
  });

  test("degrade shrinks tiles and keeps one axis + one iso view", () => {
    expect(degrade({})).toEqual({ params: { tile: 200, views: ["front", "iso"] }, notes: ["tiles 360 → 200 px", "views front, left, top, iso → front, iso"] });
    expect(degrade({ tile: 150, views: ["top", "left"], figure: 8 })).toEqual({ params: { tile: 150, views: ["top", "left"], figure: 8 }, notes: [] });
    expect(degrade({ views: ["left", "top", "back"] }).params.views).toEqual(["left", "top"]);
    expect(degrade({ views: ["iso_back", "top", "front"] }).params.views).toEqual(["top", "iso_back"]);
  });

  test("first attempt succeeds: not degraded", async () => {
    const r = await snapshotWithRetry(async (p) => p, { tile: 400 }, { timeoutMs: 10 });
    expect(r).toEqual({ result: { tile: 400 }, degraded: [], failures: [] });
    expect(degradedNote(r)).toBe("");
  });

  test("a timeout retries smaller with the same per-attempt timeout and reports it", async () => {
    const calls: [Record<string, unknown>, number][] = [];
    const r = await snapshotWithRetry(async (p, t) => { calls.push([p, t]); if (calls.length === 1) return timeout(); return "ok"; }, { tile: 400, figure: 8 }, { timeoutMs: 1234 });
    expect(calls).toEqual([[{ tile: 400, figure: 8 }, 1234], [{ tile: 200, views: ["front", "iso"], figure: 8 }, 1234]]);
    expect(r.result).toBe("ok");
    expect(degradedNote(r)).toContain("DEGRADED");
    expect(degradedNote(r)).toContain("tiles 400 → 200 px");
  });

  test("recover runs before the third attempt only", async () => {
    let recovered = 0, n = 0;
    const r = await snapshotWithRetry(async () => { n++; if (n < 3) return timeout(); return "ok"; }, {}, { timeoutMs: 100, recover: async () => { recovered++; } });
    expect([r.result, recovered, r.failures.length]).toEqual(["ok", 1, 2]);
    expect(r.degraded).toContain("headless page relaunched");
  });

  test("gives up with every failure listed; bad params are not retried", async () => {
    await expect(snapshotWithRetry(timeout, {}, { timeoutMs: 1 })).rejects.toThrow("failed after 2 attempts");
    let n = 0;
    await expect(snapshotWithRetry(async () => { n++; throw new Error('unknown view "side"'); }, {}, { timeoutMs: 1, recover: async () => {} })).rejects.toThrow("unknown view");
    expect(n).toBe(1);
  });
});
