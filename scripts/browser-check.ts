/**
 * Headless-Chrome smoke test for the real app.
 *   bun scripts/browser-check.ts [--demo] [--url=URL] [out.png] [js-expr ...]
 * Starts a temp server on a random port (unless --url), loads the page, evaluates each JS expression
 * (async allowed; helpers `voxer`, `ev(type,x,y,button?)`, `key(k,opts?)` available), prints results,
 * saves a screenshot. Requires Google Chrome at the standard macOS path or CHROME env var.
 */
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../server/index";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const rest = argv.filter((a) => !a.startsWith("--"));
const out = rest.find((a) => a.endsWith(".png")) ?? join(import.meta.dir, "out", "browser-check.png");
const exprs = rest.filter((a) => a !== out);
const urlFlag = flags.find((f) => f.startsWith("--url="))?.slice(6);
const demo = flags.includes("--demo") || (!urlFlag && exprs.length === 0);

const server = urlFlag ? null : startServer(0);
const url = urlFlag ?? `http://localhost:${server!.port}/${demo ? "?demo" : ""}`;
const profile = join(import.meta.dir, "out", "chrome-profile");
mkdirSync(join(import.meta.dir, "out"), { recursive: true });
const port = 9222 + Math.floor(Math.random() * 500);
const chrome = Bun.spawn(
  [CHROME, "--headless=new", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    `--remote-debugging-port=${port}`, "--window-size=1200,800", `--user-data-dir=${profile}`, "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);

const cleanup = () => { chrome.kill(); server?.stop(true); rmSync(profile, { recursive: true, force: true }); };
try {
  let targets: any[] = [];
  for (let i = 0; i < 40 && !targets.length; i++) {
    await Bun.sleep(250);
    targets = await fetch(`http://localhost:${port}/json`).then((r) => r.json()).catch(() => []);
  }
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("Chrome did not start");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const logs: string[] = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(String(m.data));
    if (d.id && pending.has(d.id)) { pending.get(d.id)!(d); pending.delete(d.id); }
    if (d.method === "Runtime.consoleAPICalled") logs.push(d.params.args.map((a: any) => a.value ?? a.description).join(" "));
    if (d.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + d.params.exceptionDetails.exception?.description);
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method: string, params = {}) =>
    new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url });
  await Bun.sleep(2500);
  await send("Runtime.evaluate", { expression: `
    window.ev = (t, x, y, b) => { const c = voxer.view.canvas, r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent(t, { clientX: r.left + x, clientY: r.top + y, button: b ?? 0, buttons: 1, pointerId: 1, bubbles: true, cancelable: true })); };
    window.key = (k, o) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o }));` });
  for (const e of exprs) {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    const v = r.result?.exceptionDetails ? "ERROR " + r.result.exceptionDetails.text : r.result?.result?.value;
    console.log(`> ${e}\n  => ${JSON.stringify(v)}`);
    await Bun.sleep(200);
  }
  await Bun.sleep(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await Bun.write(out, Buffer.from(shot.result.data, "base64"));
  console.log(`screenshot: ${out}`);
  const noise = /ReadPixels|GPU stall/;
  const real = logs.filter((l) => !noise.test(l));
  if (real.length) console.log("console:\n" + real.join("\n"));
  process.exitCode = real.some((l) => l.startsWith("EXCEPTION")) ? 1 : 0;
} finally {
  cleanup();
}
