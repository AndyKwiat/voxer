import type { ServerWebSocket } from "bun";
import type { SceneData } from "../src/core/Scene";

export interface ClientData {
  id: number;
  headless: boolean;
  ready: boolean;
}

type Ws = ServerWebSocket<ClientData>;

interface Pending {
  ws: Ws;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class NoClientError extends Error {
  constructor() {
    super("no Voxer page is connected (open the app, or let the MCP server launch headless Chrome)");
  }
}

/**
 * Routes agent RPCs to one *active* page over WebSocket and keeps the latest scene it pushed.
 * The active page is the most recently connected one, except that a headless page never takes over
 * from a visible one. A page that becomes active is first sent the last known scene, so control can
 * move between tabs (or from headless Chrome to your browser) without losing work.
 */
export class Hub {
  private clients: Ws[] = [];
  private active: Ws | null = null;
  private pending = new Map<number, Pending>();
  private nextRpc = 1;
  private nextClient = 1;
  lastScene: SceneData | null = null;
  /** Called when the active page pushes a new scene (e.g. to autosave). */
  onScene: ((s: SceneData) => void) | null = null;

  newClientData(): ClientData {
    return { id: this.nextClient++, headless: false, ready: false };
  }

  open(ws: Ws): void {
    this.clients.push(ws);
  }

  close(ws: Ws): void {
    this.clients = this.clients.filter((c) => c !== ws);
    for (const [id, p] of this.pending) if (p.ws === ws) { clearTimeout(p.timer); this.pending.delete(id); p.reject(new Error("page disconnected during the call")); }
    if (this.active === ws) {
      this.active = null;
      const next = [...this.clients].reverse().find((c) => c.data.ready && !c.data.headless) ?? [...this.clients].reverse().find((c) => c.data.ready);
      if (next) this.activate(next);
    }
  }

  message(ws: Ws, raw: string | Buffer): void {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    switch (msg.type) {
      case "hello":
        ws.data.headless = !!msg.headless;
        ws.data.ready = true;
        if (!(ws.data.headless && this.active && !this.active.data.headless)) this.activate(ws);
        else send(ws, { type: "active", active: false });
        return;
      case "scene":
        if (ws === this.active && msg.scene) { this.lastScene = msg.scene; this.onScene?.(msg.scene); }
        return;
      case "result":
      case "error": {
        const p = this.pending.get(msg.id);
        if (!p || p.ws !== ws) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.type === "result") p.resolve(msg.result);
        else p.reject(new Error(String(msg.error)));
        return;
      }
    }
  }

  private activate(ws: Ws): void {
    if (this.active && this.active !== ws) send(this.active, { type: "active", active: false });
    this.active = ws;
    if (this.lastScene) send(ws, { type: "load", scene: this.lastScene });
    send(ws, { type: "active", active: true });
  }

  /** Calls `api[method](params)` in the active page. */
  rpc(method: string, params: unknown = {}, timeoutMs = 60_000): Promise<unknown> {
    const ws = this.active;
    if (!ws) return Promise.reject(new NoClientError());
    const id = this.nextRpc++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`"${method}" timed out after ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { ws, resolve, reject, timer });
      send(ws, { type: "rpc", id, method, params });
    });
  }

  /** Sends a message to every connected page. */
  broadcast(msg: object): void {
    for (const c of this.clients) send(c, msg);
  }

  status() {
    return {
      clients: this.clients.filter((c) => c.data.ready).map((c) => ({ id: c.data.id, headless: c.data.headless, active: c === this.active })),
      active: this.active ? { id: this.active.data.id, headless: this.active.data.headless } : null,
      hasScene: !!this.lastScene,
    };
  }
}

function send(ws: Ws, msg: object): void {
  try { ws.send(JSON.stringify(msg)); } catch { /* closing */ }
}
