import { join, normalize } from "node:path";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

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

export function startServer(port = 0, root = PUBLIC_DIR) {
  return Bun.serve({ port, fetch: (req) => handleRequest(req, root) });
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
  if (process.stdin.isTTY) console.log("press o to open in a browser, q to quit");
  bindKeys(url);
}
