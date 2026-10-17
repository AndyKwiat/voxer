/**
 * Headless Chrome over the DevTools protocol, shared by `scripts/browser-check.ts` and the MCP server.
 * Uses 127.0.0.1 explicitly: Bun resolves "localhost" to ::1 first, where Chrome's DevTools isn't listening.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export interface Cdp {
  send(method: string, params?: object): Promise<any>;
  /** Console lines and uncaught exceptions ("EXCEPTION …") seen so far. */
  logs: string[];
  close(): void;
}

export interface Chrome {
  proc: ReturnType<typeof Bun.spawn>;
  port: number;
  /** Connects to the first page target. */
  page(): Promise<Cdp>;
  kill(): void;
}

export async function launchChrome(opts: { url?: string; width?: number; height?: number; profileDir?: string } = {}): Promise<Chrome> {
  const profile = opts.profileDir ?? mkdtempSync(join(tmpdir(), "voxer-chrome-"));
  const port = 9222 + Math.floor(Math.random() * 2000);
  const proc = Bun.spawn(
    [CHROME, "--headless=new", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`,
      `--window-size=${opts.width ?? 1200},${opts.height ?? 800}`, `--user-data-dir=${profile}`, opts.url ?? "about:blank"],
    { stdout: "ignore", stderr: "ignore" },
  );
  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    proc.kill();
    // Chrome may still hold files for a moment; best effort.
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };

  let targets: any[] = [];
  for (let i = 0; i < 60 && !targets.some((t) => t.type === "page"); i++) {
    await Bun.sleep(250);
    targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
  }
  if (!targets.some((t) => t.type === "page")) { kill(); throw new Error(`Chrome did not start (${CHROME})`); }

  return {
    proc,
    port,
    kill,
    async page() {
      const list: any[] = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (!page) throw new Error("no page target");
      return connectCdp(page.webSocketDebuggerUrl);
    },
  };
}

async function connectCdp(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const logs: string[] = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) { pending.get(d.id)!(d); pending.delete(d.id); }
    if (d.method === "Runtime.consoleAPICalled") logs.push(d.params.args.map((a: any) => a.value ?? a.description).join(" "));
    if (d.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + d.params.exceptionDetails.exception?.description);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  return {
    logs,
    send: (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }),
    close: () => ws.close(),
  };
}
