/**
 * Headless Voxer for scripts: an app server plus a headless Chrome page you drive over RPC.
 *
 *   import { startVoxer } from "voxer/scripts/lib/headless";   // or a relative path
 *   const vx = await startVoxer({ scratch: true });
 *   await vx.rpc("new_scene", { size: 32 });
 *   await vx.rpc("run", { ops: [{ op: "box", min: [0, 0, 0], max: [7, 3, 7], color: "#aa6633" }] });
 *   const snap = await vx.rpc("snapshot", { views: ["front", "iso"], figure: true });
 *   await Bun.write("/tmp/x.png", Buffer.from(snap.data, "base64"));
 *   vx.close();
 *
 * `rpc(method, params)` calls `window.voxer.api[method](params)` in the page (see `src/agent/Api.ts`):
 * `info`, `run {ops}`, `new_scene`, `serialize`, `load {scene}`, `snapshot`, `run_script {code}`, …
 * It throws on errors; pass `{ timeoutMs }` as the third argument to bound slow calls (default 60 s).
 *
 * Scratch (the default, `scratch: true`): the server keeps scenes / reference in memory, never autosaves
 * and listens on a private port (random unless `port` is given), so nothing touches `models/` and no
 * browser tab you have open on 3005 can take the session over (or be taken over). `scratch: false` with
 * `modelsDir` uses that directory like the real server (autosave included).
 *
 * The bundle (`public/main.js`) is built first if it's missing; pass `build: true` to always rebuild.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startServer } from "../../server/index";
import { launchChrome, type Chrome } from "./chrome";

const ROOT = resolve(import.meta.dir, "..", "..");

export interface HeadlessOptions {
  /** In-memory store, no autosave, private port. Default true. */
  scratch?: boolean;
  /** Port for the app server; default 0 = a random free port. */
  port?: number;
  /** Only with `scratch: false`: where scenes / autosave live. */
  modelsDir?: string;
  /** Rebuild the bundle even if `public/main.js` exists. */
  build?: boolean;
  /** Chrome window size. Default 1100×900. */
  width?: number;
  height?: number;
  /** Extra page URL params, e.g. `size=64`. */
  query?: string;
}

export interface Voxer {
  /** `http://127.0.0.1:<port>` of the app server (open it in a browser to watch). */
  base: string;
  port: number;
  server: ReturnType<typeof startServer>;
  chrome: Chrome;
  /** Calls `window.voxer.api[method](params)` in the page. */
  rpc(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<any>;
  close(): void;
}

/** Builds `public/main.js` (if missing or `force`). Throws with the build's stderr on failure. */
export function ensureBundle(force = false): void {
  if (!force && existsSync(resolve(ROOT, "public", "main.js"))) return;
  const b = Bun.spawnSync([process.execPath, "run", "build"], { cwd: ROOT, stdout: "ignore", stderr: "pipe" });
  if (b.exitCode !== 0) throw new Error("bun run build failed: " + b.stderr.toString());
}

export async function startVoxer(opts: HeadlessOptions = {}): Promise<Voxer> {
  const scratch = opts.scratch ?? true;
  ensureBundle(opts.build);
  const server = startServer(opts.port ?? 0, resolve(ROOT, "public"), scratch ? { scratch: true } : { modelsDir: opts.modelsDir });
  const port = server.port!;
  const base = `http://127.0.0.1:${port}`;
  let chrome: Chrome;
  try {
    chrome = await launchChrome({ url: `${base}/?agent=headless${opts.query ? "&" + opts.query : ""}`, width: opts.width ?? 1100, height: opts.height ?? 900 });
  } catch (e) { server.stop(true); throw e; }
  const close = () => { chrome.kill(); server.stop(true); };
  for (let i = 0; !server.hub.status().active; i++) {
    if (i > 120) { close(); throw new Error("headless Voxer page did not connect within 30 s"); }
    await Bun.sleep(250);
  }
  return {
    base, port, server, chrome, close,
    async rpc(method, params = {}, o = {}) {
      const r = await fetch(base + "/api/rpc", { method: "POST", body: JSON.stringify({ method, params, timeoutMs: o.timeoutMs }) });
      const body = (await r.json()) as { result?: unknown; error?: string };
      if (body.error) throw new Error(`${method}: ${body.error}`);
      return body.result;
    },
  };
}
