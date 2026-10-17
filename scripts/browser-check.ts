/**
 * Headless-Chrome smoke test for the real app.
 *   bun scripts/browser-check.ts [--demo] [--url=URL] [out.png] [js-expr ...]
 * Starts a temp server on a random port (unless --url), loads the page, evaluates each JS expression
 * (async allowed; helpers `voxer`, `ev(type,x,y,button?)`, `key(k,opts?)`, `showImage(base64)` available),
 * prints results, saves a screenshot. Requires Google Chrome at the standard macOS path or CHROME env var.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../server/index";
import { launchChrome } from "./lib/chrome";

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const rest = argv.filter((a) => !a.startsWith("--"));
const out = rest.find((a) => a.endsWith(".png")) ?? join(import.meta.dir, "out", "browser-check.png");
const exprs = rest.filter((a) => a !== out);
const urlFlag = flags.find((f) => f.startsWith("--url="))?.slice(6);
const demo = flags.includes("--demo") || (!urlFlag && exprs.length === 0);

const server = urlFlag ? null : startServer(0);
const url = urlFlag ?? `http://127.0.0.1:${server!.port}/${demo ? "?demo" : ""}`;
mkdirSync(join(import.meta.dir, "out"), { recursive: true });
const chrome = await launchChrome();

const cleanup = () => { chrome.kill(); server?.stop(true); };
try {
  const cdp = await chrome.page();
  const { send, logs } = cdp;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url });
  await Bun.sleep(2500);
  await send("Runtime.evaluate", { expression: `
    window.ev = (t, x, y, b) => { const c = voxer.view.canvas, r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent(t, { clientX: r.left + x, clientY: r.top + y, button: b ?? 0, buttons: 1, pointerId: 1, bubbles: true, cancelable: true })); };
    window.key = (k, o) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o }));
    window.showImage = (b64) => { const i = new Image(); i.src = 'data:image/png;base64,' + b64;
      document.body.innerHTML = ''; document.body.style.background = '#333'; document.body.appendChild(i); return i.decode().then(() => [i.width, i.height]); };` });
  for (const e of exprs) {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    const v = r.result?.exceptionDetails ? "ERROR " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text) : r.result?.result?.value;
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
  cdp.close();
} finally {
  cleanup();
}
