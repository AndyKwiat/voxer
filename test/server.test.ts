import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidSceneName, resolvePublicPath, startServer } from "../server/index";
import { encodeScene } from "../src/core/Scene";
import { VoxelGrid } from "../src/core/VoxelGrid";

let root: string;
let scenes: string;
let server: ReturnType<typeof startServer>;
let base: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "voxer-"));
  scenes = mkdtempSync(join(tmpdir(), "voxer-scenes-"));
  writeFileSync(join(root, "index.html"), "<h1>hi</h1>");
  writeFileSync(join(root, "main.js"), "console.log(1)");
  server = startServer(0, root, scenes);
  base = `http://localhost:${server.port}`;
});
afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(scenes, { recursive: true, force: true });
});

describe("static server", () => {

  test("serves index.html at /", async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("<h1>hi</h1>");
    expect(r.headers.get("content-type")).toContain("text/html");
  });

  test("serves static assets with content type", async () => {
    const r = await fetch(`${base}/main.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("javascript");
  });

  test("404 for missing file, 405 for POST", async () => {
    expect((await fetch(`${base}/nope.txt`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
  });

  test("rejects path traversal", () => {
    expect(resolvePublicPath("/../etc/passwd", "/srv/pub")).toBeNull();
    expect(resolvePublicPath("/a/../../x", "/srv/pub")).toBeNull();
    expect(resolvePublicPath("/a/b.js", "/srv/pub")).toBe("/srv/pub/a/b.js");
    expect(resolvePublicPath("/", "/srv/pub")).toBe("/srv/pub/index.html");
  });
});

describe("scenes API", () => {
  const doc = () => {
    const g = new VoxelGrid(8);
    g.set(1, 1, 1, 1);
    return encodeScene(g, ["#ff0000"]);
  };
  const put = (name: string, body: unknown) =>
    fetch(`${base}/api/scenes/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("PUT then GET round-trips a scene", async () => {
    expect((await put("my castle", doc())).status).toBe(200);
    const r = await fetch(`${base}/api/scenes/my%20castle`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(JSON.parse(JSON.stringify(doc())));
  });

  test("PUT overwrites the same name (plain Save)", async () => {
    await put("hut", doc());
    const g = new VoxelGrid(8);
    g.set(2, 2, 2, 1);
    g.set(3, 3, 3, 1);
    await put("hut", encodeScene(g, ["#00ff00"]));
    const back = await (await fetch(`${base}/api/scenes/hut`)).json();
    expect(back.palette).toEqual(["#00ff00"]);
  });

  test("lists saved scenes, newest first", async () => {
    const { scenes: list } = await (await fetch(`${base}/api/scenes`)).json();
    const names = list.map((s: { name: string }) => s.name);
    expect(names).toContain("hut");
    expect(names).toContain("my castle");
    expect(list[0]).toHaveProperty("modified");
    expect(list[0]).toHaveProperty("bytes");
  });

  test("404 for an unknown scene", async () => {
    const r = await fetch(`${base}/api/scenes/nothing-here`);
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBeString();
  });

  test("rejects bad names and traversal", async () => {
    expect(isValidSceneName("ok name_1-2")).toBe(true);
    expect(isValidSceneName("../etc/passwd")).toBe(false);
    expect(isValidSceneName(" leading")).toBe(false);
    expect(isValidSceneName("dots.json")).toBe(false);
    expect(isValidSceneName("")).toBe(false);
    expect((await put("../escape", doc())).status).toBe(400);
    expect((await fetch(`${base}/api/scenes/..%2Fescape`)).status).toBe(400);
  });

  test("refuses to store something it could not load back", async () => {
    expect((await put("bad", { format: "voxer-scene", version: 1 })).status).toBe(400);
    expect((await put("bad", { hello: 1 })).status).toBe(400);
    const r = await fetch(`${base}/api/scenes/bad`, { method: "PUT", body: "not json" });
    expect(r.status).toBe(400);
    expect((await fetch(`${base}/api/scenes/bad`)).status).toBe(404); // nothing was written
  });

  test("405 for unsupported methods", async () => {
    expect((await fetch(`${base}/api/scenes/hut`, { method: "DELETE" })).status).toBe(405);
    expect((await fetch(`${base}/api/scenes`, { method: "PUT" })).status).toBe(405);
  });
});
