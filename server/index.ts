import { mkdir, readdir, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { decodeScene, SceneFormatError } from "../src/core/Scene";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const SCENES_DIR = process.env.VOXER_SCENES ?? join(import.meta.dir, "..", "saves");

/** Scene names are the on-disk identity, so keep them boring: no dots, slashes or leading spaces. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

export function isValidSceneName(name: string): boolean {
  return NAME_RE.test(name);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * `GET /api/scenes` list · `GET|PUT /api/scenes/:name` read/write one.
 * Returns null when the path is not an API route, so the caller falls through to static files.
 */
export async function handleApi(req: Request, url: URL, dir = SCENES_DIR): Promise<Response | null> {
  if (url.pathname !== "/api/scenes" && !url.pathname.startsWith("/api/scenes/")) return null;
  const rest = url.pathname.slice("/api/scenes".length).replace(/^\//, "");
  const name = decodeURIComponent(rest);

  if (!name) {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      return json({ scenes: [] }); // no saves yet
    }
    const scenes = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const s = await stat(join(dir, f));
      scenes.push({ name: f.slice(0, -5), bytes: s.size, modified: s.mtime.toISOString() });
    }
    scenes.sort((a, b) => (a.modified < b.modified ? 1 : -1));
    return json({ scenes });
  }

  if (!isValidSceneName(name)) return json({ error: "invalid scene name" }, 400);
  const file = join(dir, `${name}.json`);

  if (req.method === "GET") {
    const f = Bun.file(file);
    if (!(await f.exists())) return json({ error: "no such scene" }, 404);
    return new Response(f, { headers: { "content-type": "application/json" } });
  }

  if (req.method === "PUT") {
    let doc: unknown;
    try {
      doc = await req.json();
      decodeScene(doc); // never write something we could not load back
    } catch (e) {
      const why = e instanceof SceneFormatError ? e.message : "body must be a Voxer scene JSON document";
      return json({ error: why }, 400);
    }
    await mkdir(dir, { recursive: true });
    await Bun.write(file, JSON.stringify(doc));
    return json({ name });
  }

  return json({ error: "method not allowed" }, 405);
}

export function resolvePublicPath(pathname: string, root = PUBLIC_DIR): string | null {
  let p = decodeURIComponent(pathname);
  if (p.endsWith("/")) p += "index.html";
  const full = normalize(join(root, p));
  if (!full.startsWith(root + "/") && full !== root) return null; // path traversal
  return full;
}

export async function handleRequest(req: Request, root = PUBLIC_DIR, scenesDir = SCENES_DIR): Promise<Response> {
  const url = new URL(req.url);
  const api = await handleApi(req, url, scenesDir);
  if (api) return api;
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
  const path = resolvePublicPath(url.pathname, root);
  if (!path) return new Response("Forbidden", { status: 403 });
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not Found", { status: 404 });
  return new Response(file);
}

export function startServer(port = 0, root = PUBLIC_DIR, scenesDir = SCENES_DIR) {
  return Bun.serve({ port, fetch: (req) => handleRequest(req, root, scenesDir) });
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
  const server = startServer(Number(process.env.PORT ?? 3005));
  const url = `http://localhost:${server.port}`;
  console.log(`voxer running at ${url}`);
  console.log(`scenes in ${SCENES_DIR}`);
  if (process.stdin.isTTY) console.log("press o to open in a browser, q to quit");
  bindKeys(url);
}
