import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePublicPath, startServer } from "../server/index";

describe("static server", () => {
  let root: string;
  let server: ReturnType<typeof startServer>;
  let base: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "voxer-"));
    writeFileSync(join(root, "index.html"), "<h1>hi</h1>");
    writeFileSync(join(root, "main.js"), "console.log(1)");
    server = startServer(0, root);
    base = `http://localhost:${server.port}`;
  });
  afterAll(() => {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

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
