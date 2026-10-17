import type { Vec3 } from "./Raycast";
import { EMPTY } from "./VoxelGrid";

/** Ops whose job is to cut openings into what earlier ops built; erasing earlier cells is a note for them, not a warning. */
export const CARVING_OPS: ReadonlySet<string> = new Set(["door", "window", "arch"]);

/**
 * Write reports for a batch of drawing ops (`Draft` feeds a `WriteTracker`). Everything is counted per
 * cell, not per write call: a cell an op touches several times counts once, classified by its value
 * before vs after that op. Totals compare the grid before the batch with the final draft.
 */

export interface WriteCounts {
  /** empty → filled */
  set: number;
  /** filled → empty */
  erased: number;
  /** filled → a different color */
  recolored: number;
  /** written, but ended with the value it had */
  noop: number;
  /** filled (non-erase) writes attempted at integer coords outside the grid (dropped) */
  clipped: number;
  /** writes with non-integer coords (dropped) */
  invalid: number;
}

export interface Box { min: Vec3; max: Vec3 }

/** Cells an op changed that an earlier op of the same batch had just set (or recolored). */
export interface Overwrite { op: number; erased: number; recolored: number }

export interface OpReport extends WriteCounts {
  index: number;
  op: string;
  /** bbox of the clipped (out-of-grid) coordinates */
  clipBox?: Box;
  /** clip counts are an estimate (shape too large to enumerate) */
  clipApprox?: boolean;
  /** earlier ops whose cells this op erased / recolored */
  overwrote?: Overwrite[];
}

export interface WriteReport {
  size: number;
  totals: WriteCounts & { clipBox?: Box };
  ops: OpReport[];
  /** ops left out of `ops` (long run_script batches), counts are still in totals/warnings */
  opsOmitted?: number;
  /** suspicious things, most important first: clipping, then erasing what an earlier op drew */
  warnings: string[];
  /** informational: recoloring cells an earlier op drew (usual when painting detail) */
  notes: string[];
}

const zero = (): WriteCounts => ({ set: 0, erased: 0, recolored: 0, noop: 0, clipped: 0, invalid: 0 });

interface Segment extends OpReport {
  over: Map<number, Overwrite>;
  /** opened for loose writes (script `set` calls); left out of the report when it wrote nothing */
  implicit?: boolean;
}

const MAX_OPS_LISTED = 200;
const MAX_LINES = 20;

/** Collects per-op write statistics for a `Draft`. Ops are numbered in the order they begin. */
export class WriteTracker {
  private segs: Segment[] = [];
  private cur: Segment | null = null;
  /** cell → value before the current op first touched it */
  private touched = new Map<number, number>();
  /** cell → op that last made it filled in this batch */
  private owner = new Map<number, number>();

  constructor(private readonly size: number, private readonly valueAt: (i: number) => number) {}

  /**
   * Starts a new op (ending the open one). Returns its index. `implicit` segments (loose script writes)
   * are dropped from the report if they recorded nothing. Writes with no open op start an implicit "set".
   */
  begin(name: string, implicit = false): number {
    this.end();
    const seg: Segment = { index: this.segs.length, op: name, ...zero(), over: new Map(), implicit };
    this.segs.push(seg);
    this.cur = seg;
    return seg.index;
  }

  /** Ends the open op, classifying the cells it touched. */
  end(): void {
    const seg = this.cur;
    if (!seg) return;
    this.cur = null;
    for (const [i, before] of this.touched) {
      const after = this.valueAt(i);
      if (after === before) { seg.noop++; continue; }
      if (before === EMPTY) seg.set++;
      else if (after === EMPTY) seg.erased++;
      else seg.recolored++;
      const o = this.owner.get(i);
      if (o !== undefined && before !== EMPTY) {
        let w = seg.over.get(o);
        if (!w) seg.over.set(o, (w = { op: o, erased: 0, recolored: 0 }));
        if (after === EMPTY) w.erased++;
        else w.recolored++;
      }
      if (after === EMPTY) this.owner.delete(i);
      else this.owner.set(i, seg.index);
    }
    this.touched.clear();
  }

  private open(): Segment {
    return this.cur ?? this.segs[this.begin("set", true)]!;
  }

  /** An in-grid write to cell index `i`, whose value was `prev` just before. */
  write(i: number, prev: number): void {
    this.open();
    if (!this.touched.has(i)) this.touched.set(i, prev);
  }

  invalid(): void {
    this.open().invalid++;
  }

  /** A dropped out-of-grid write. */
  clip(x: number, y: number, z: number): void {
    const s = this.open();
    s.clipped++;
    growBox(s, x, y, z);
  }

  /** `count` out-of-grid cells inside `lo..hi`, estimated (too many to enumerate). */
  clipEstimate(count: number, lo: Vec3, hi: Vec3): void {
    const s = this.open();
    s.clipped += count;
    s.clipApprox = true;
    growBox(s, lo.x, lo.y, lo.z);
    growBox(s, hi.x, hi.y, hi.z);
  }

  /** Final report. `changes` maps cell index → final value; `original(i)` is the grid before the batch. */
  report(changes: ReadonlyMap<number, number>, original: (i: number) => number): WriteReport {
    this.end();
    const totals: WriteReport["totals"] = zero();
    for (const [i, after] of changes) {
      const before = original(i);
      if (before === after) totals.noop++;
      else if (before === EMPTY) totals.set++;
      else if (after === EMPTY) totals.erased++;
      else totals.recolored++;
    }
    const warnings: string[] = [], notes: string[] = [];
    const ops: OpReport[] = [];
    let listed = 0;
    const grid = `grid 0..${this.size - 1}`;
    for (const s of this.segs) {
      if (s.implicit && !(s.set || s.erased || s.recolored || s.noop || s.clipped || s.invalid)) continue;
      totals.clipped += s.clipped;
      totals.invalid += s.invalid;
      if (s.clipBox) {
        growBox(totals, s.clipBox.min.x, s.clipBox.min.y, s.clipBox.min.z);
        growBox(totals, s.clipBox.max.x, s.clipBox.max.y, s.clipBox.max.z);
      }
      const { over, implicit, ...rep } = s;
      const label = `op ${s.index} (${s.op})`;
      if (s.clipped) {
        warnings.push(`${label}: ${s.clipApprox ? "~" : ""}${s.clipped} cells clipped outside the grid (${outside(s.clipBox!, this.size)}; ${grid})`);
      }
      if (s.invalid) warnings.push(`${label}: ${s.invalid} writes ignored (non-integer coordinates)`);
      if (over.size) {
        rep.overwrote = [...over.values()].sort((a, b) => a.op - b.op);
        const erasedFrom = rep.overwrote.filter((w) => w.erased);
        const recolFrom = rep.overwrote.filter((w) => w.recolored);
        const n = (ws: Overwrite[], k: "erased" | "recolored") => ws.reduce((t, w) => t + w[k], 0);
        if (erasedFrom.length) (CARVING_OPS.has(s.op) ? notes : warnings).push(`${label}: erased ${n(erasedFrom, "erased")} cells set by ${opList(erasedFrom)} in this batch`);
        if (recolFrom.length) notes.push(`${label}: recolored ${n(recolFrom, "recolored")} cells set by ${opList(recolFrom)} in this batch`);
      }
      listed++;
      if (ops.length < MAX_OPS_LISTED) ops.push(rep);
    }
    // clipping first, then erasures
    warnings.sort((a, b) => rank(a) - rank(b));
    const report: WriteReport = { size: this.size, totals, ops, warnings: capLines(warnings), notes: capLines(notes) };
    if (listed > ops.length) report.opsOmitted = listed - ops.length;
    return report;
  }
}

const rank = (w: string) => (w.includes("clipped") ? 0 : w.includes("ignored") ? 1 : 2);

function capLines(lines: string[]): string[] {
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… and ${lines.length - MAX_LINES} more`] : lines;
}

function opList(ws: Overwrite[]): string {
  return ws.length === 1 ? `op ${ws[0]!.op}` : `ops ${ws.map((w) => w.op).join(", ")}`;
}

function growBox(t: { clipBox?: Box }, x: number, y: number, z: number): void {
  if (!t.clipBox) { t.clipBox = { min: { x, y, z }, max: { x, y, z } }; return; }
  const { min, max } = t.clipBox;
  min.x = Math.min(min.x, x); min.y = Math.min(min.y, y); min.z = Math.min(min.z, z);
  max.x = Math.max(max.x, x); max.y = Math.max(max.y, y); max.z = Math.max(max.z, z);
}

/** "x 30..33, y -2..0": the axes on which the clipped coordinates leave the grid. */
function outside(b: Box, size: number): string {
  const parts: string[] = [];
  for (const a of ["x", "y", "z"] as const) {
    if (b.min[a] < 0 || b.max[a] > size - 1) parts.push(`${a} ${b.min[a]}..${b.max[a]}`);
  }
  return parts.join(", ");
}

/** One-line totals, e.g. `changed 523: +500 set, -12 erased, ~11 recolored; 40 no-op; 41 clipped`. */
export function summarizeReport(r: WriteReport): string {
  const t = r.totals;
  const changed = t.set + t.erased + t.recolored;
  const parts = [`+${t.set} set`, `-${t.erased} erased`, `~${t.recolored} recolored`];
  let s = `changed ${changed}: ${parts.join(", ")}`;
  if (t.noop) s += `; ${t.noop} no-op`;
  if (t.clipped) s += `; ${t.clipped} clipped`;
  if (t.invalid) s += `; ${t.invalid} invalid`;
  return s;
}

/** Human-readable report: warnings first, then notes, then totals and a compact per-op line. */
export function formatReport(r: WriteReport): string {
  const lines = [...r.warnings.map((w) => `WARNING: ${w}`), ...r.notes.map((n) => `note: ${n}`), summarizeReport(r)];
  if (r.ops.length > 1) {
    const op = (o: OpReport) => {
      const bits = [o.set && `+${o.set}`, o.erased && `-${o.erased}`, o.recolored && `~${o.recolored}`, o.clipped && `${o.clipped} clipped`].filter(Boolean);
      return `#${o.index} ${o.op} ${bits.length ? bits.join(" ") : "0"}`;
    };
    lines.push(`ops: ${r.ops.map(op).join(" | ")}${r.opsOmitted ? ` | … ${r.opsOmitted} more` : ""}`);
  }
  return lines.join("\n");
}
