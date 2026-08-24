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

if (import.meta.main) {
  const server = startServer(Number(process.env.PORT ?? 3000));
  console.log(`voxer running at http://localhost:${server.port}`);
}
