import type { Server } from "bun";
import { join, normalize } from "node:path";
import type { SceneData } from "../src/core/Scene";
import { Hub, NoClientError, type ClientData } from "./Hub";
import { Store, validSceneName } from "./Store";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
export const MODELS_DIR = join(import.meta.dir, "..", "models");

export function resolvePublicPath(pathname: string, root = PUBLIC_DIR): string | null {
  let p = decodeURIComponent(pathname);
  if (p.endsWith("/")) p += "index.html";
  const full = normalize(join(root, p));
  if (!full.startsWith(root + "/") && full !== root) return null; // path traversal
  return full;
}

export async function handleRequest(req: Request, root = PUBLIC_DIR): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
  const path = resolvePublicPath(url.pathname, root);
  if (!path) return new Response("Forbidden", { status: 403 });
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not Found", { status: 404 });
  return new Response(file);
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** `/api/*` routes: agent RPC relay, reference image, scenes. Returns null for non-API paths. */
export async function handleApi(req: Request, hub: Hub, store: Store): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (!p.startsWith("/api/")) return null;
  const m = req.method;

  if (p === "/api/health") return json({ ok: true, app: "voxer" });
  if (p === "/api/agent/status" && m === "GET") return json(hub.status());

  if (p === "/api/rpc" && m === "POST") {
    const body = (await req.json().catch(() => null)) as { method?: string; params?: unknown; timeoutMs?: number } | null;
    if (!body?.method) return json({ error: "expected { method, params }" }, 400);
    try {
      return json({ result: await hub.rpc(body.method, body.params, body.timeoutMs) });
    } catch (e) {
      return json({ error: (e as Error).message }, e instanceof NoClientError ? 503 : 400);
    }
  }

  if (p === "/api/scene" && m === "GET") return hub.lastScene ? json(hub.lastScene) : json({ error: "no scene yet" }, 404);

  if (p === "/api/reference") {
    if (m === "GET") {
      const r = await store.getReference();
      return r ? new Response(new Blob([r.bytes as Uint8Array<ArrayBuffer>]), { headers: { "content-type": r.type, "cache-control": "no-store" } }) : json({ error: "no reference image" }, 404);
    }
    if (m === "PUT") {
      const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
      try { await store.putReference(new Uint8Array(await req.arrayBuffer()), type); }
      catch (e) { return json({ error: (e as Error).message }, 415); }
      hub.broadcast({ type: "reference" });
      return json({ ok: true });
    }
    if (m === "DELETE") { await store.deleteReference(); hub.broadcast({ type: "reference" }); return json({ ok: true }); }
  }

  if (p === "/api/scenes" && m === "GET") return json({ scenes: await store.listScenes() });
  const sm = /^\/api\/scenes\/([^/]+)$/.exec(p);
  if (sm) {
    const name = decodeURIComponent(sm[1]!);
    if (!validSceneName(name)) return json({ error: "scene names are 1-64 of [A-Za-z0-9_.-], not starting with . or _" }, 400);
    if (m === "GET") { const s = await store.getScene(name); return s ? json(s) : json({ error: `no scene "${name}"` }, 404); }
    if (m === "PUT") {
      const s = (await req.json().catch(() => null)) as SceneData | null;
      if (!s || s.version !== 1 || typeof s.data !== "string" || !Array.isArray(s.palette)) return json({ error: "expected a scene { version: 1, size, palette, data }" }, 400);
      await store.putScene(name, s);
      return json({ ok: true });
    }
  }
  return json({ error: "not found" }, 404);
}

export interface ServerOptions {
  /** Where scenes / reference / autosave are kept; omitted = in memory (tests). */
  modelsDir?: string;
}

/** HTTP + `/agent` WebSocket server. `hub` and `store` are exposed for tests and the MCP server. */
export function startServer(port = 0, root = PUBLIC_DIR, opts: ServerOptions = {}) {
  const hub = new Hub();
  const store = new Store(opts.modelsDir);
  if (opts.modelsDir) {
    void store.getAutosave().then((s) => { if (s && !hub.lastScene) hub.lastScene = s; });
    let t: ReturnType<typeof setTimeout> | null = null;
    hub.onScene = (s) => { if (t) clearTimeout(t); t = setTimeout(() => void store.putAutosave(s), 1000); };
  }
  const server = Bun.serve<ClientData>({
    port,
    async fetch(req: Request, srv: Server<ClientData>) {
      if (new URL(req.url).pathname === "/agent") {
        return srv.upgrade(req, { data: hub.newClientData() }) ? undefined : new Response("expected a WebSocket", { status: 400 });
      }
      return (await handleApi(req, hub, store)) ?? handleRequest(req, root);
    },
    websocket: {
      open: (ws) => hub.open(ws),
      message: (ws, msg) => hub.message(ws, msg),
      close: (ws) => hub.close(ws),
    },
  });
  return Object.assign(server, { hub, store });
}

/** Opens `url` in the default browser. Returns false if the platform command failed to start. */
function openBrowser(url: string): boolean {
  const cmd = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** `o` opens the app, `q` / Ctrl-C quits. No-op without a TTY (CI, pipes, tests). */
function bindKeys(url: string): void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", (k: string) => {
    if (k === "o") { if (!openBrowser(url)) console.log(`could not open a browser; visit ${url}`); }
    else if (k === "q" || k === "\u0003") process.exit(0);
  });
}

if (import.meta.main) {
  const server = startServer(Number(process.env.PORT ?? 3005), PUBLIC_DIR, { modelsDir: MODELS_DIR });
  const url = `http://localhost:${server.port}`;
  console.log(`voxer running at ${url}`);
  if (process.stdin.isTTY) console.log("press o to open in a browser, q to quit");
  bindKeys(url);
}
