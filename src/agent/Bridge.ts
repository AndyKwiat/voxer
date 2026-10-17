import type { Editor } from "../core/Editor";
import type { SceneData } from "../core/Scene";
import type { Api } from "./Api";
import type { ReferenceImage } from "./Reference";

/** Messages the hub (`server/Hub.ts`) sends to a page. */
type ServerMsg =
  | { type: "rpc"; id: number; method: string; params?: unknown }
  | { type: "load"; scene: SceneData }
  | { type: "active"; active: boolean }
  | { type: "reference" };

/**
 * Connects the page to the server's agent hub over WebSocket (`/agent`). The hub routes agent RPCs
 * to the *active* page (the most recently connected one); the active page pushes its scene back
 * after changes so a page that connects later (or after a reload) starts from the same scene.
 */
export class Bridge {
  private ws: WebSocket | null = null;
  private active = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private retry = 500;

  constructor(private editor: Editor, private api: Api, private reference: ReferenceImage, private statusEl: HTMLElement, private headless: boolean) {
    const push = () => this.schedulePush();
    editor.on("voxels", push);
    editor.on("palette", push);
    editor.on("reset", push);
    this.render("connecting…");
    void this.connect();
  }

  private async connect(): Promise<void> {
    // Only our Bun server has the hub; skip quietly when the page is hosted elsewhere.
    const ok = await fetch("/api/health", { cache: "no-store" }).then((r) => r.ok).catch(() => false);
    if (!ok) { this.render("offline"); return void setTimeout(() => this.connect(), (this.retry = Math.min(this.retry * 2, 10000))); }
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/agent`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      ws.send(JSON.stringify({ type: "hello", headless: this.headless }));
    };
    ws.onmessage = (m) => { void this.onMessage(JSON.parse(String(m.data)) as ServerMsg); };
    ws.onclose = () => {
      this.ws = null;
      this.active = false;
      this.render("disconnected");
      setTimeout(() => this.connect(), this.retry);
    };
  }

  private async onMessage(msg: ServerMsg): Promise<void> {
    switch (msg.type) {
      case "load":
        try { this.editor.load(msg.scene); } catch (e) { console.warn("agent: could not load synced scene", e); }
        return;
      case "active":
        this.active = msg.active;
        this.render(msg.active ? "connected (active)" : "control moved to another tab — reload to take it back");
        if (msg.active) this.schedulePush();
        return;
      case "reference":
        await this.reference.refresh();
        return;
      case "rpc": {
        const fn = (this.api as Record<string, unknown>)[msg.method];
        let reply: object;
        try {
          if (typeof fn !== "function") throw new Error(`unknown method "${msg.method}"`);
          const result = await (fn as (p: unknown) => unknown)(msg.params ?? {});
          reply = { type: "result", id: msg.id, result: result ?? null };
        } catch (e) {
          reply = { type: "error", id: msg.id, error: (e as Error).message ?? String(e) };
        }
        // Push any pending scene change *before* the reply, so once a caller sees a result the hub has
        // the scene it produced (a stalled headless page can then be relaunched without losing work).
        this.flushPush();
        this.ws?.send(JSON.stringify(reply));
        return;
      }
    }
  }

  private schedulePush(): void {
    if (!this.active) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.flushPush(), 250);
  }

  /** Sends the scene now if a push is pending. */
  private flushPush(): void {
    if (!this.pushTimer) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = null;
    if (this.active && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "scene", scene: this.editor.serialize() }));
  }

  private render(state: string): void {
    this.statusEl.textContent = `agent: ${state}`;
    this.statusEl.classList.toggle("active", this.active);
  }
}
