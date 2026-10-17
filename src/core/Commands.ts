import type { Vec3 } from "./Raycast";
import type { Axis, Edit } from "./Tools";
import { EMPTY, type VoxelGrid } from "./VoxelGrid";
import { applyPartOp, isPartOp, PART_OP_NAMES, patternBox, type PartOp, type PatternBoxOp } from "./Parts";
import { WriteTracker, type WriteReport } from "./Report";

/**
 * High-level, batchable drawing operations (the agent / scripting API). Each op is planned into a
 * `Draft` overlay so later ops in a batch see earlier ones; the draft becomes one `Edit[]` (one undo step).
 * Coordinates are integer cells; bounds are inclusive; anything outside the grid is clipped, not an error.
 */

/** A color: palette index (number) or hex string (`"#a0522d"`, added to the palette if missing). */
export type Color = number | string;
export type V3 = [number, number, number] | Vec3;

export type Op =
  | { op: "set"; voxels: ({ x: number; y: number; z: number; color: Color | null } | [number, number, number, Color | null])[] }
  | { op: "box"; min: V3; max: V3; color?: Color; erase?: boolean; hollow?: boolean }
  | { op: "ellipsoid"; center: V3; radius: number | V3; color?: Color; erase?: boolean; hollow?: boolean }
  | { op: "cylinder"; base: V3; radius: number; height: number; axis?: Axis; color?: Color; erase?: boolean; hollow?: boolean }
  | { op: "line"; from: V3; to: V3; color?: Color; erase?: boolean; radius?: number }
  | { op: "layer"; axis: Axis; index: number; rows: string[]; legend: Record<string, Color | null>; offset?: [number, number]; clear?: boolean }
  | { op: "mirror"; axis: Axis; pivot?: number; source?: "lower" | "upper" }
  | { op: "translate"; offset: V3; min?: V3; max?: V3; copy?: boolean }
  | { op: "replace_color"; from: Color; to: Color | null; min?: V3; max?: V3 }
  | { op: "clear" }
  | PatternBoxOp
  | PartOp;

export const OP_NAMES = ["set", "box", "ellipsoid", "cylinder", "line", "layer", "mirror", "translate", "replace_color", "clear", ...PART_OP_NAMES] as const;

/** Maps a `Color` to a grid cell value (palette index + 1). */
export type ColorResolver = (c: Color) => number;

/**
 * Pending changes over a grid; reads see earlier writes. Every write (and every dropped out-of-grid
 * write) is counted by `tracker`, per op between `beginOp`s, so any op that writes through `set` is reported.
 */
export class Draft {
  private changes = new Map<number, number>();
  readonly tracker: WriteTracker;
  constructor(readonly grid: VoxelGrid) {
    this.tracker = new WriteTracker(grid.size, (i) => this.changes.get(i) ?? this.grid.data[i]!);
  }

  /** Starts counting writes for a new op (ends the previous one); returns its index. */
  beginOp(name: string, implicit = false): number {
    return this.tracker.begin(name, implicit);
  }
  endOp(): void {
    this.tracker.end();
  }
  /** Write report for everything planned so far (see `Report.ts`). */
  report(): WriteReport {
    return this.tracker.report(this.changes, (i) => this.grid.data[i]!);
  }

  get(x: number, y: number, z: number): number {
    if (!this.grid.inBounds(x, y, z)) return EMPTY;
    const i = this.grid.index(x, y, z);
    return this.changes.get(i) ?? this.grid.data[i]!;
  }

  /** Writes a cell; out-of-bounds or non-integer coords are ignored (counted as invalid / clipped; erasing outside the grid is not a clip). */
  set(x: number, y: number, z: number, v: number): void {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) return this.tracker.invalid();
    if (!this.grid.inBounds(x, y, z)) { if (v !== EMPTY) this.tracker.clip(x, y, z); return; }
    const i = this.grid.index(x, y, z);
    this.tracker.write(i, this.changes.get(i) ?? this.grid.data[i]!);
    this.changes.set(i, v);
  }

  /** Occupied cells (after pending changes) inside an optional inclusive box. */
  *occupied(min?: Vec3, max?: Vec3): IterableIterator<Vec3 & { value: number }> {
    const s = this.grid.size;
    const lo = min ?? { x: 0, y: 0, z: 0 }, hi = max ?? { x: s - 1, y: s - 1, z: s - 1 };
    for (let y = Math.max(0, lo.y); y <= Math.min(s - 1, hi.y); y++)
      for (let z = Math.max(0, lo.z); z <= Math.min(s - 1, hi.z); z++)
        for (let x = Math.max(0, lo.x); x <= Math.min(s - 1, hi.x); x++) {
          const value = this.get(x, y, z);
          if (value !== EMPTY) yield { x, y, z, value };
        }
  }

  edits(): Edit[] {
    const s = this.grid.size, out: Edit[] = [];
    for (const [i, after] of this.changes) {
      const before = this.grid.data[i]!;
      if (before === after) continue;
      out.push({ x: i % s, y: Math.floor(i / (s * s)), z: Math.floor(i / s) % s, before, after });
    }
    return out;
  }
}

export function vec(v: V3): Vec3 {
  return Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v;
}

const AXES: readonly Axis[] = ["x", "y", "z"];

function sortedBox(a: V3, b: V3): [Vec3, Vec3] {
  const p = vec(a), q = vec(b);
  const lo = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), z: Math.min(p.z, q.z) };
  const hi = { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y), z: Math.max(p.z, q.z) };
  return [roundV(lo), roundV(hi)];
}
const roundV = (v: Vec3): Vec3 => ({ x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) });

function shapeValue(op: { color?: Color; erase?: boolean }, resolve: ColorResolver): number {
  if (op.erase) return EMPTY;
  if (op.color === undefined) throw new Error(`${(op as { op: string }).op}: needs "color" or "erase": true`);
  return resolve(op.color);
}

/**
 * Fills cells inside a solid described by `inside(x,y,z)` within a bounding box. With `hollow`, only
 * cells with at least one 6-neighbour outside the solid are written (a 1-voxel shell).
 */
function fillSolid(d: Draft, lo: Vec3, hi: Vec3, inside: (x: number, y: number, z: number) => boolean, v: number, hollow = false) {
  const s = d.grid.size;
  for (let y = Math.max(0, lo.y); y <= Math.min(s - 1, hi.y); y++)
    for (let z = Math.max(0, lo.z); z <= Math.min(s - 1, hi.z); z++)
      for (let x = Math.max(0, lo.x); x <= Math.min(s - 1, hi.x); x++) {
        if (!inside(x, y, z)) continue;
        if (hollow && inside(x + 1, y, z) && inside(x - 1, y, z) && inside(x, y + 1, z) && inside(x, y - 1, z) && inside(x, y, z + 1) && inside(x, y, z - 1)) continue;
        d.set(x, y, z, v);
      }
  if (v !== EMPTY) countClipped(d, lo, hi, (x, y, z) => inside(x, y, z) &&
    !(hollow && inside(x + 1, y, z) && inside(x - 1, y, z) && inside(x, y + 1, z) && inside(x, y - 1, z) && inside(x, y, z + 1) && inside(x, y, z - 1)));
}

/** Largest out-of-grid region `fillSolid` enumerates exactly; beyond it the clip count is a bbox estimate. */
const MAX_CLIP_SCAN = 1 << 22;

/** Reports the cells of a solid (`lo..hi`, `filled`) that fall outside the grid as clipped. Ops that clamp their own loops to the grid (instead of letting `Draft.set` drop writes) call this. */
export function countClipped(d: Draft, lo: Vec3, hi: Vec3, filled: (x: number, y: number, z: number) => boolean) {
  const s = d.grid.size;
  if (lo.x >= 0 && lo.y >= 0 && lo.z >= 0 && hi.x < s && hi.y < s && hi.z < s) return;
  const ext = (a: number, b: number) => Math.max(0, b - a + 1);
  const total = ext(lo.x, hi.x) * ext(lo.y, hi.y) * ext(lo.z, hi.z);
  if (!total) return;
  if (total > MAX_CLIP_SCAN) {
    const inGrid = ext(Math.max(0, lo.x), Math.min(s - 1, hi.x)) * ext(Math.max(0, lo.y), Math.min(s - 1, hi.y)) * ext(Math.max(0, lo.z), Math.min(s - 1, hi.z));
    if (total > inGrid) d.tracker.clipEstimate(total - inGrid, lo, hi);
    return;
  }
  for (let y = lo.y; y <= hi.y; y++)
    for (let z = lo.z; z <= hi.z; z++) {
      const rowIn = y >= 0 && y < s && z >= 0 && z < s;
      for (let x = lo.x; x <= hi.x; x++) {
        if (rowIn && x >= 0 && x < s) { x = s - 1; continue; } // skip the in-grid span of this row
        if (filled(x, y, z)) d.tracker.clip(x, y, z);
      }
    }
}

/** Applies one op to a draft. Throws on malformed input (the whole batch is then discarded). */
export function applyOp(d: Draft, op: Op, resolve: ColorResolver): void {
  switch (op.op) {
    case "set":
      for (const e of op.voxels) {
        const [x, y, z, c] = Array.isArray(e) ? e : [e.x, e.y, e.z, e.color];
        d.set(x, y, z, c === null ? EMPTY : resolve(c));
      }
      return;

    case "box": {
      if ("pattern" in op && op.pattern !== undefined) return patternBox(d, op, resolve);
      const [lo, hi] = sortedBox(op.min, op.max);
      const v = shapeValue(op, resolve);
      const inBox = (x: number, y: number, z: number) => x >= lo.x && x <= hi.x && y >= lo.y && y <= hi.y && z >= lo.z && z <= hi.z;
      fillSolid(d, lo, hi, inBox, v, op.hollow);
      return;
    }

    case "ellipsoid": {
      const c = vec(op.center);
      const r = typeof op.radius === "number" ? { x: op.radius, y: op.radius, z: op.radius } : vec(op.radius);
      if (r.x <= 0 || r.y <= 0 || r.z <= 0) throw new Error("ellipsoid: radius must be > 0");
      const v = shapeValue(op, resolve);
      // Cells whose centers (x+.5 …) fall inside, measured from the center cell's center; +.5 slack rounds nicely.
      const inside = (x: number, y: number, z: number) =>
        ((x - c.x) / (r.x + 0.5)) ** 2 + ((y - c.y) / (r.y + 0.5)) ** 2 + ((z - c.z) / (r.z + 0.5)) ** 2 <= 1;
      const lo = roundV({ x: c.x - r.x - 1, y: c.y - r.y - 1, z: c.z - r.z - 1 });
      const hi = roundV({ x: c.x + r.x + 1, y: c.y + r.y + 1, z: c.z + r.z + 1 });
      fillSolid(d, lo, hi, inside, v, op.hollow);
      return;
    }

    case "cylinder": {
      const b = vec(op.base), axis = op.axis ?? "y";
      if (op.radius <= 0 || op.height === 0) throw new Error("cylinder: radius must be > 0 and height non-zero");
      const v = shapeValue(op, resolve);
      const [u, w] = AXES.filter((a) => a !== axis) as [Axis, Axis];
      const h0 = Math.min(b[axis], b[axis] + op.height + (op.height > 0 ? -1 : 1));
      const h1 = Math.max(b[axis], b[axis] + op.height + (op.height > 0 ? -1 : 1));
      const inside = (x: number, y: number, z: number) => {
        const p = { x, y, z };
        return p[axis] >= h0 && p[axis] <= h1 && ((p[u] - b[u]) ** 2 + (p[w] - b[w]) ** 2) <= (op.radius + 0.5) ** 2;
      };
      const R = Math.ceil(op.radius) + 1;
      const lo = { ...b, [u]: b[u] - R, [w]: b[w] - R, [axis]: h0 } as Vec3;
      const hi = { ...b, [u]: b[u] + R, [w]: b[w] + R, [axis]: h1 } as Vec3;
      fillSolid(d, roundV(lo), roundV(hi), inside, v, op.hollow);
      return;
    }

    case "line": {
      const a = vec(op.from), b = vec(op.to), v = shapeValue(op, resolve);
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z), 1);
      const r = op.radius ?? 0;
      for (let i = 0; i <= n; i++) {
        const p = roundV({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
        if (r <= 0) d.set(p.x, p.y, p.z, v);
        else {
          const R = Math.ceil(r);
          for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++)
            if (dx * dx + dy * dy + dz * dz <= (r + 0.5) ** 2) d.set(p.x + dx, p.y + dy, p.z + dz, v);
        }
      }
      return;
    }

    case "layer": {
      const legend = new Map<string, number>();
      for (const [ch, c] of Object.entries(op.legend)) {
        if ([...ch].length !== 1) throw new Error(`layer: legend keys must be single characters, got "${ch}"`);
        legend.set(ch, c === null ? EMPTY : resolve(c));
      }
      const [a, b] = op.offset ?? [0, 0];
      const n = op.rows.length;
      op.rows.forEach((row, r) => {
        [...row].forEach((ch, col) => {
          const p = layerCell(op.axis, op.index, a, b, r, col, n);
          const v = legend.get(ch);
          if (v !== undefined) d.set(p.x, p.y, p.z, v);
          else if (ch === "." || ch === " ") { if (op.clear) d.set(p.x, p.y, p.z, EMPTY); }
          else throw new Error(`layer: character "${ch}" (row ${r}, col ${col}) is not in the legend`);
        });
      });
      return;
    }

    case "mirror": {
      const axis = op.axis, s = d.grid.size, pivot = op.pivot ?? s - 1;
      // A cell c maps to pivot - c. "lower" copies cells with 2c < pivot onto the other side.
      const lower = (op.source ?? "lower") === "lower";
      const src = [...d.occupied()].filter((p) => (lower ? 2 * p[axis] < pivot : 2 * p[axis] > pivot));
      for (const p of src) d.set(axis === "x" ? pivot - p.x : p.x, axis === "y" ? pivot - p.y : p.y, axis === "z" ? pivot - p.z : p.z, p.value);
      return;
    }

    case "translate": {
      const o = roundV(vec(op.offset));
      const [lo, hi] = op.min && op.max ? sortedBox(op.min, op.max) : [undefined, undefined];
      const cells = [...d.occupied(lo, hi)];
      if (!op.copy) for (const p of cells) d.set(p.x, p.y, p.z, EMPTY);
      for (const p of cells) d.set(p.x + o.x, p.y + o.y, p.z + o.z, p.value);
      return;
    }

    case "replace_color": {
      const from = resolve(op.from), to = op.to === null ? EMPTY : resolve(op.to);
      const [lo, hi] = op.min && op.max ? sortedBox(op.min, op.max) : [undefined, undefined];
      for (const p of [...d.occupied(lo, hi)]) if (p.value === from) d.set(p.x, p.y, p.z, to);
      return;
    }

    case "clear":
      for (const p of [...d.occupied()]) d.set(p.x, p.y, p.z, EMPTY);
      return;

    default:
      if (isPartOp(op)) return applyPartOp(d, op, resolve);
      throw new Error(`unknown op "${(op as { op: unknown }).op}"; expected one of ${OP_NAMES.join(", ")}`);
  }
}

/**
 * World cell for character `col` of row `r` (of `n` rows) in a layer, laid out as the slice looks in the
 * matching snapshot view (row 0 at the top of the picture):
 *  - axis "y" (top view, slice y=index):    x = a + col, z = b + r       (row 0 = back, smallest z)
 *  - axis "z" (front view, slice z=index):  x = a + col, y = b + n-1-r   (last row sits at y = b)
 *  - axis "x" (left view, slice x=index):   z = a + col, y = b + n-1-r
 */
export function layerCell(axis: Axis, index: number, a: number, b: number, r: number, col: number, n: number): Vec3 {
  switch (axis) {
    case "y": return { x: a + col, y: index, z: b + r };
    case "z": return { x: a + col, y: b + n - 1 - r, z: index };
    case "x": return { x: index, y: b + n - 1 - r, z: a + col };
  }
}

/** Plans a batch of ops into edits against the current grid (nothing is applied). */
export function planOps(grid: VoxelGrid, ops: readonly Op[], resolve: ColorResolver, d = new Draft(grid)): Edit[] {
  ops.forEach((op, i) => {
    d.beginOp(String((op as { op?: string }).op));
    try { applyOp(d, op, resolve); }
    catch (e) { throw new Error(`op ${i} (${(op as { op?: string }).op}): ${(e as Error).message}`); }
  });
  d.endOp();
  return d.edits();
}

/** `planOps` plus a write report (counts, clipping, same-batch overwrites; see `Report.ts`). */
export function planOpsReport(grid: VoxelGrid, ops: readonly Op[], resolve: ColorResolver): { edits: Edit[]; report: WriteReport } {
  const d = new Draft(grid);
  const edits = planOps(grid, ops, resolve, d);
  return { edits, report: d.report() };
}

/** Inclusive bounding box of occupied cells, or null if empty. */
export function boundingBox(grid: VoxelGrid): { min: Vec3; max: Vec3 } | null {
  if (!grid.count) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of grid.occupied()) {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
  }
  return { min, max };
}

/** Voxel count per cell value. */
export function colorCounts(grid: VoxelGrid): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of grid.occupied()) m.set(p.value, (m.get(p.value) ?? 0) + 1);
  return m;
}

/**
 * ASCII dump of one slice, in the same layout `layer` reads (so it can be edited and written back).
 * Cells are drawn with `chars[value]` from the returned legend; empty = ".". Rows cover the whole grid
 * unless a crop box is given.
 */
export function dumpLayer(grid: VoxelGrid, axis: Axis, index: number, hexOf: (cell: number) => string, crop?: { a0: number; a1: number; b0: number; b1: number }) {
  const s = grid.size;
  const a0 = crop?.a0 ?? 0, a1 = crop?.a1 ?? s - 1, b0 = crop?.b0 ?? 0, b1 = crop?.b1 ?? s - 1;
  const n = b1 - b0 + 1;
  const SYMBOLS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@$%&*+=?<>~^";
  const charOf = new Map<number, string>();
  const legend: Record<string, string> = {};
  const rows: string[] = [];
  for (let r = 0; r < n; r++) {
    let row = "";
    for (let col = 0; col <= a1 - a0; col++) {
      const p = layerCell(axis, index, a0, b0, r, col, n);
      const v = grid.get(p.x, p.y, p.z);
      if (v === EMPTY) { row += "."; continue; }
      let ch = charOf.get(v);
      if (!ch) {
        ch = SYMBOLS[charOf.size] ?? "#";
        charOf.set(v, ch);
        legend[ch] = hexOf(v);
      }
      row += ch;
    }
    rows.push(row);
  }
  return { axis, index, offset: [a0, b0] as [number, number], rows, legend };
}
