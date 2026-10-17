/**
 * Resilient snapshots for the MCP `snapshot` tool. Headless Chrome renders with SwiftShader (CPU), which
 * can be slow or stall on a busy machine, so a snapshot is tried in up to three attempts:
 *   1. as asked, with a short per-attempt timeout (`VOXER_SNAPSHOT_TIMEOUT_MS`, default 20 s);
 *   2. degraded: tiles ≤ 200 px and at most 2 views (first axis view + first iso view asked for);
 *   3. only if `recover` is given (the MCP server passes one when the page is its own headless Chrome):
 *      recover (relaunch the page; it is re-sent the hub's last scene), then the degraded request again.
 * Only timeouts / lost pages are retried; other errors (bad params) are thrown at once. The result says
 * exactly what was degraded, so the agent knows the sheet isn't what it asked for.
 */

export interface SnapshotArgs {
  views?: string[];
  tile?: number;
  frame?: string;
  reference?: boolean;
  shading?: string;
  columns?: number;
  /** Draw a scale figure (MCP name; the page API takes `figure: height`). */
  figure?: boolean;
  figure_height?: number;
  [k: string]: unknown;
}

export const DEFAULT_TILE = 360;
export const DEGRADED_TILE = 200;
const DEFAULT_VIEWS = ["front", "left", "top", "iso"];

/** MCP tool arguments → page `api.snapshot` params (`figure` + `figure_height` → `figure: height`). */
export function toPageParams(a: SnapshotArgs): Record<string, unknown> {
  const { figure, figure_height, ...rest } = a;
  const p: Record<string, unknown> = { ...rest };
  if (figure || figure_height !== undefined) p.figure = figure === false ? false : (figure_height ?? 8);
  return p;
}

/** Smaller request for a retry: tile ≤ 200 px, ≤ 2 views. `notes` lists each reduction made. */
export function degrade(p: Record<string, unknown>): { params: Record<string, unknown>; notes: string[] } {
  const notes: string[] = [];
  const out = { ...p };
  const tile = typeof p.tile === "number" ? p.tile : DEFAULT_TILE;
  if (tile > DEGRADED_TILE) { out.tile = DEGRADED_TILE; notes.push(`tiles ${tile} → ${DEGRADED_TILE} px`); }
  const views = Array.isArray(p.views) && p.views.length ? (p.views as string[]) : DEFAULT_VIEWS;
  if (views.length > 2) {
    const axis = views.find((v) => !v.startsWith("iso")), iso = views.find((v) => v.startsWith("iso"));
    const keep = axis && iso ? [axis, iso] : views.slice(0, 2);
    out.views = keep;
    notes.push(`views ${views.join(", ")} → ${keep.join(", ")}`);
  }
  return { params: out, notes };
}

export interface RetryOptions {
  /** Per-attempt timeout (ms). */
  timeoutMs: number;
  /** Called before the third attempt (e.g. relaunch headless Chrome). Omit to stop after two. */
  recover?: () => Promise<void>;
  log?: (msg: string) => void;
}

export interface RetryResult<T> {
  result: T;
  /** Empty when the first attempt succeeded. */
  degraded: string[];
  /** One line per failed attempt. */
  failures: string[];
}

/** Timeouts, a page that went away mid-call, or none connected: worth retrying. Anything else is a real error. */
export function isRetryable(e: Error): boolean {
  return /timed out|disconnected|no Voxer page|fetch failed|ECONNRE/i.test(e.message);
}

/** Runs `call(params, timeoutMs)` with the retry plan above. Throws (with every failure) if all attempts fail. */
export async function snapshotWithRetry<T>(
  call: (params: Record<string, unknown>, timeoutMs: number) => Promise<T>,
  params: Record<string, unknown>,
  opts: RetryOptions,
): Promise<RetryResult<T>> {
  const failures: string[] = [];
  const small = degrade(params);
  const attempts: { params: Record<string, unknown>; degraded: string[]; timeoutMs: number; before?: () => Promise<void>; label: string }[] = [
    { params, degraded: [], timeoutMs: opts.timeoutMs, label: "attempt 1 (as requested)" },
    { params: small.params, degraded: small.notes, timeoutMs: opts.timeoutMs, label: "attempt 2 (smaller)" },
  ];
  if (opts.recover) attempts.push({ params: small.params, degraded: [...small.notes, "headless page relaunched"], timeoutMs: Math.round(opts.timeoutMs * 1.5), before: opts.recover, label: "attempt 3 (relaunched page, smaller)" });
  for (const a of attempts) {
    try {
      if (a.before) await a.before();
      const result = await call(a.params, a.timeoutMs);
      return { result, degraded: a.degraded, failures };
    } catch (e) {
      if (!isRetryable(e as Error)) throw e; // e.g. a bad view name: retrying won't help
      const msg = `${a.label}: ${(e as Error).message}`;
      failures.push(msg);
      opts.log?.(`snapshot ${msg}`);
    }
  }
  throw new Error(`snapshot failed after ${attempts.length} attempts — ${failures.join("; ")}`);
}

/** One-line note for the tool result describing a degraded snapshot (empty string if not degraded). */
export function degradedNote(r: { degraded: string[]; failures: string[] }): string {
  if (!r.failures.length) return "";
  return ` DEGRADED after ${r.failures.length} failed attempt(s) (${r.failures.join("; ")}): ${r.degraded.join("; ") || "same request"}.`;
}
