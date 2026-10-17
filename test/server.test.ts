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

/** A fake page: connects to /agent, answers RPCs with `handler`, records messages. */
async function fakePage(base: string, headless = false, handler: (m: string, p: any) => unknown = (m, p) => ({ m, p })) {
  const ws = new WebSocket(base.replace("http", "ws") + "/agent");
  const msgs: any[] = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    msgs.push(msg);
    if (msg.type === "rpc") {
      try { ws.send(JSON.stringify({ type: "result", id: msg.id, result: handler(msg.method, msg.params) })); }
      catch (err) { ws.send(JSON.stringify({ type: "error", id: msg.id, error: (err as Error).message })); }
    }
  };
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: "hello", headless }));
  await Bun.sleep(30);
  return { ws, msgs, last: (t: string) => [...msgs].reverse().find((m) => m.type === t) };
}

describe("agent hub + api", () => {
  let server: ReturnType<typeof startServer>;
  let base: string;
  const rpc = (method: string, params?: unknown) =>
    fetch(`${base}/api/rpc`, { method: "POST", body: JSON.stringify({ method, params }) }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

  beforeAll(() => {
    server = startServer(0, mkdtempSync(join(tmpdir(), "voxer-")));
    base = `http://localhost:${server.port}`;
  });
  afterAll(() => server.stop(true));

  test("health; rpc with no page is 503", async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, app: "voxer" });
    expect((await rpc("info")).status).toBe(503);
  });

  test("routes rpc to the active page; errors come back as 400", async () => {
    const page = await fakePage(base, false, (m, p) => { if (m === "boom") throw new Error("bad op"); return { echo: p }; });
    expect(page.last("active")).toEqual({ type: "active", active: true });
    expect(await rpc("run", { ops: [1] })).toEqual({ status: 200, body: { result: { echo: { ops: [1] } } } });
    expect(await rpc("boom")).toEqual({ status: 400, body: { error: "bad op" } });
    page.ws.close();
    await Bun.sleep(30);
  });

  test("a new page takes over and is sent the last scene; headless never steals from visible", async () => {
    const a = await fakePage(base, false, () => "a");
    const scene = { version: 1, size: 4, palette: ["#000000"], data: "AEA=" };
    a.ws.send(JSON.stringify({ type: "scene", scene }));
    await Bun.sleep(30);
    expect(await (await fetch(`${base}/api/scene`)).json()).toEqual(scene);
    const b = await fakePage(base, false, () => "b");
    expect(b.msgs.find((m) => m.type === "load")?.scene).toEqual(scene);
    expect(a.last("active").active).toBe(false);
    expect((await rpc("x")).body.result).toBe("b");
    const h = await fakePage(base, true, () => "h");
    expect(h.last("active").active).toBe(false);
    expect((await rpc("x")).body.result).toBe("b");
    b.ws.close();
    await Bun.sleep(30);
    expect((await rpc("x")).body.result).toBe("a"); // visible preferred over headless on fallback
    const status = (await (await fetch(`${base}/api/agent/status`)).json()) as any;
    expect(status.active.headless).toBe(false);
    a.ws.close(); h.ws.close();
    await Bun.sleep(30);
  });

  test("reference image round-trip notifies pages", async () => {
    const page = await fakePage(base);
    expect((await fetch(`${base}/api/reference`)).status).toBe(404);
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    expect((await fetch(`${base}/api/reference`, { method: "PUT", headers: { "content-type": "image/png" }, body: png })).status).toBe(200);
    expect((await fetch(`${base}/api/reference`, { method: "PUT", headers: { "content-type": "text/plain" }, body: "x" })).status).toBe(415);
    const r = await fetch(`${base}/api/reference`);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);
    await Bun.sleep(30);
    expect(page.msgs.some((m) => m.type === "reference")).toBe(true);
    await fetch(`${base}/api/reference`, { method: "DELETE" });
    expect((await fetch(`${base}/api/reference`)).status).toBe(404);
    page.ws.close();
  });

  test("scenes: save, list, load, name validation", async () => {
    const scene = { version: 1, size: 4, palette: ["#000000"], data: "AEA=" };
    expect((await fetch(`${base}/api/scenes/house`, { method: "PUT", body: JSON.stringify(scene) })).status).toBe(200);
    expect(await (await fetch(`${base}/api/scenes`)).json()).toEqual({ scenes: ["house"] });
    expect(await (await fetch(`${base}/api/scenes/house`)).json()).toEqual(scene);
    expect((await fetch(`${base}/api/scenes/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/scenes/_autosave`, { method: "PUT", body: JSON.stringify(scene) })).status).toBe(400);
    expect((await fetch(`${base}/api/scenes/x`, { method: "PUT", body: "{}" })).status).toBe(400);
    const v2 = { ...scene, version: 2, anchors: { door: { x: 1, y: 0, z: 3 } } };
    expect((await fetch(`${base}/api/scenes/house2`, { method: "PUT", body: JSON.stringify(v2) })).status).toBe(200);
    expect(await (await fetch(`${base}/api/scenes/house2`)).json()).toEqual(v2);
    expect((await fetch(`${base}/api/scenes/x`, { method: "PUT", body: JSON.stringify({ ...scene, version: 3 }) })).status).toBe(400);
  });
});
