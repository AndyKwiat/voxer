/**
 * Voxer MCP server (stdio). Registered in `.mcp.json`; run manually with `bun mcp/server.ts`.
 *
 * Plumbing: tools → HTTP on the Voxer app server (`/api/rpc`, relayed over WebSocket to the active page,
 * which owns the scene and renders snapshots). If no app server is running on VOXER_PORT (3005) it builds
 * the bundle and starts one in-process; if no page is connected it launches headless Chrome. A browser
 * tab you open (`open_viewer`) takes over and the headless Chrome is closed.
 *
 * Protocol: newline-delimited JSON-RPC 2.0 on stdin/stdout (MCP "stdio" transport). Logs go to stderr.
 */
import { extname, isAbsolute, resolve } from "node:path";
import { launchChrome, type Chrome } from "../scripts/lib/chrome";
import { MODELS_DIR, startServer } from "../server/index";
import { INSTRUCTIONS, TOOLS } from "./tools";

const PORT = Number(process.env.VOXER_PORT ?? 3005);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = resolve(import.meta.dir, "..");
const log = (...a: unknown[]) => console.error("[voxer-mcp]", ...a);

// ---------- app server + page management ----------

let ownServer: ReturnType<typeof startServer> | null = null;
let chrome: Chrome | null = null;
let launching: Promise<void> | null = null;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(BASE + path, init);
}

async function serverUp(): Promise<boolean> {
  const r = await api("/api/health").catch(() => null);
  if (!r?.ok) return false;
  const body = (await r.json().catch(() => null)) as { app?: string } | null;
  if (body?.app !== "voxer") throw new Error(`port ${PORT} is serving something that isn't Voxer; set VOXER_PORT`);
  return true;
}

async function ensureServer(): Promise<void> {
  if (await serverUp()) return;
  log("building bundle and starting app server on", PORT);
  const build = Bun.spawnSync([process.execPath, "run", "build"], { cwd: ROOT, stdout: "ignore", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error("bun run build failed: " + build.stderr.toString());
  ownServer = startServer(PORT, resolve(ROOT, "public"), { modelsDir: MODELS_DIR });
}

type Status = { clients: { headless: boolean; active: boolean }[]; active: { headless: boolean } | null };
const status = async (): Promise<Status> => (await (await api("/api/agent/status")).json()) as Status;

/** Ensures some page is connected and active, launching headless Chrome if needed. */
async function ensurePage(): Promise<void> {
  await ensureServer();
  if ((await status()).active) return;
  launching ??= (async () => {
    if (!chrome) {
      log("no page connected; launching headless Chrome");
      chrome = await launchChrome({ url: `${BASE}/?agent=headless` });
      chrome.proc.exited.then(() => { chrome = null; });
    }
    for (let i = 0; i < 80; i++) {
      if ((await status()).active) return;
      await Bun.sleep(250);
    }
    throw new Error("headless page did not connect within 20 s");
  })().finally(() => { launching = null; });
  await launching;
}

/** Closes our headless Chrome once a visible tab has taken over. */
async function reapHeadless(): Promise<void> {
  if (!chrome) return;
  const s = await status().catch(() => null);
  if (s?.active && !s.active.headless) { log("visible viewer is active; closing headless Chrome"); chrome.kill(); chrome = null; }
}
setInterval(() => void reapHeadless(), 3000);

async function rpc(method: string, params: unknown = {}): Promise<any> {
  await ensurePage();
  let r = await api("/api/rpc", { method: "POST", body: JSON.stringify({ method, params }) });
  if (r.status === 503) { await ensurePage(); r = await api("/api/rpc", { method: "POST", body: JSON.stringify({ method, params }) }); }
  const body = (await r.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

// ---------- tool implementations ----------

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const text = (v: unknown): Content[] => [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }];
/** Scene info without the full palette (scene_info has it). */
const brief = ({ palette, ...rest }: { palette?: string[] }) => ({ ...rest, paletteSize: palette?.length });
/** Human-readable write report (warnings first) followed by the JSON result. */
const withSummary = (summary: unknown, rest: object): Content[] => text(typeof summary === "string" ? `${summary}\n${JSON.stringify(rest)}` : rest);
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

const handlers: Record<string, (a: any) => Promise<Content[]>> = {
  async scene_info() {
    const info = await rpc("info");
    const s = await status();
    return text({ ...info, viewers: s.clients, viewerUrl: BASE });
  },
  new_scene: async (a) => text(brief(await rpc("new_scene", a))),
  async draw(a) {
    const { summary, ...r } = await rpc("run", { ops: a.ops });
    const info = await rpc("info");
    return withSummary(summary, { ...r, bbox: info.bbox, colorsUsed: info.colorsUsed.length });
  },
  async run_script(a) {
    const { summary, ...r } = await rpc("run_script", { code: a.code });
    return withSummary(summary, r);
  },
  get_layer: async (a) => text(await rpc("get_layer", a)),
  async snapshot(a) {
    const r = await rpc("snapshot", a);
    const note = a.reference && !r.hasReference ? " (no reference image is set)" : "";
    return [{ type: "image", data: r.data, mimeType: r.mime }, ...text(`${r.width}×${r.height} sheet${note}. Ruler numbers are cell coordinates.`)];
  },
  set_view: async (a) => text(await rpc("set_view", a)),
  async undo(a) {
    let n = 0;
    for (let i = 0; i < (a.steps ?? 1); i++) { if (!(await rpc("undo")).undone) break; n++; }
    return text({ undone: n });
  },
  async redo(a) {
    let n = 0;
    for (let i = 0; i < (a.steps ?? 1); i++) { if (!(await rpc("redo")).redone) break; n++; }
    return text({ redone: n });
  },
  set_palette: async (a) => text(await rpc("set_palette", a)),
  async set_reference(a) {
    await ensureServer();
    let bytes: ArrayBuffer, type: string;
    if (a.url) {
      const r = await fetch(a.url);
      if (!r.ok) throw new Error(`fetch ${a.url}: ${r.status}`);
      bytes = await r.arrayBuffer();
      type = (r.headers.get("content-type") ?? "").split(";")[0]!;
    } else if (a.path) {
      const p = isAbsolute(a.path) ? a.path : resolve(process.cwd(), a.path);
      const f = Bun.file(p);
      if (!(await f.exists())) throw new Error(`no file at ${p}`);
      bytes = await f.arrayBuffer();
      type = IMAGE_TYPES[extname(p).toLowerCase()] ?? f.type;
    } else throw new Error("give a path or url");
    const r = await api("/api/reference", { method: "PUT", headers: { "content-type": type }, body: bytes });
    if (!r.ok) throw new Error(((await r.json()) as { error: string }).error);
    const info = await rpc("reload_reference");
    return text({ ok: true, ...info });
  },
  async get_reference() {
    await ensureServer();
    const r = await api("/api/reference");
    if (r.status === 404) return text("No reference image. Ask the user to paste/drop one into the app, or call set_reference.");
    const type = r.headers.get("content-type") ?? "image/png";
    return [{ type: "image", data: Buffer.from(await r.arrayBuffer()).toString("base64"), mimeType: type }];
  },
  async sample_reference(a) {
    await rpc("reload_reference");
    return text(await rpc("sample_reference", a));
  },
  async save_scene(a) {
    const scene = await rpc("serialize");
    const r = await api(`/api/scenes/${encodeURIComponent(a.name)}`, { method: "PUT", body: JSON.stringify(scene) });
    if (!r.ok) throw new Error(((await r.json()) as { error: string }).error);
    return text({ saved: `models/${a.name}.json` });
  },
  async load_scene(a) {
    await ensureServer();
    const r = await api(`/api/scenes/${encodeURIComponent(a.name)}`);
    if (!r.ok) throw new Error(((await r.json()) as { error: string }).error);
    return text(brief(await rpc("load", { scene: await r.json() })));
  },
  async list_scenes() {
    await ensureServer();
    return text(await (await api("/api/scenes")).json());
  },
  async open_viewer() {
    await ensurePage(); // make sure the current scene exists on the hub before the tab connects
    const url = `http://localhost:${PORT}/`;
    const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    return text(`Opened ${url}. The tab becomes the active viewer with the current scene.`);
  },
  async export_mesh(a) {
    const { path, ...opts } = a;
    const r = await rpc("export_mesh", opts);
    if (!path) return text(r);
    const file = isAbsolute(path) ? path : resolve(process.cwd(), path);
    await Bun.write(file, Buffer.from(r.data, "base64"));
    return text({ written: file, format: r.format, bytes: r.bytes, ...r.stats });
  },
  define_slot: async (a) => text(await rpc("define_slot", a)),
  recolor_slot: async (a) => text(await rpc("recolor_slot", a)),
  async make_variant(a) {
    const r = await rpc("make_variant", { slots: a.slots });
    if (!a.save_as) return text(r);
    const s = await api(`/api/scenes/${encodeURIComponent(a.save_as)}`, { method: "PUT", body: JSON.stringify(r.scene) });
    if (!s.ok) throw new Error(((await s.json()) as { error: string }).error);
    return text({ saved: `models/${a.save_as}.json`, slots: r.slots });
  },
  list_slots: async () => text(await rpc("list_slots")),
  set_anchor: async (a) => text(await rpc("set_anchor", a)),
  remove_anchor: async (a) => text(await rpc("remove_anchor", a)),
  list_anchors: async () => text(await rpc("list_anchors")),
  async lint(a) {
    const { summary, ...r } = await rpc("lint", a);
    return withSummary(summary, r);
  },
};

// ---------- MCP stdio transport ----------

type Req = { jsonrpc: "2.0"; id?: number | string; method: string; params?: any };
const write = (msg: object): void => { process.stdout.write(JSON.stringify(msg) + "\n"); };
const reply = (id: Req["id"], result: unknown) => write({ jsonrpc: "2.0", id, result });
const fail = (id: Req["id"], code: number, message: string) => write({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(req: Req): Promise<void> {
  const isNotification = req.id === undefined;
  switch (req.method) {
    case "initialize":
      return reply(req.id, {
        protocolVersion: req.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "voxer", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply(req.id, {});
    case "tools/list":
      return reply(req.id, { tools: TOOLS });
    case "tools/call": {
      const name = req.params?.name as string;
      const h = handlers[name];
      if (!h) return fail(req.id, -32602, `unknown tool ${name}`);
      try {
        reply(req.id, { content: await h(req.params?.arguments ?? {}) });
      } catch (e) {
        reply(req.id, { content: text(`Error: ${(e as Error).message}`), isError: true });
      }
      return;
    }
    default:
      if (!isNotification) fail(req.id, -32601, `method not found: ${req.method}`);
  }
}

function shutdown(): never {
  chrome?.kill();
  ownServer?.stop(true);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req: Req;
    try { req = JSON.parse(line); } catch { fail(null as never, -32700, "parse error"); continue; }
    void handle(req).catch((e) => log("handler crashed", e));
  }
});
process.stdin.on("end", shutdown);
log(`ready (app port ${PORT})`);
