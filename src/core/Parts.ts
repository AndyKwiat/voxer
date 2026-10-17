import type { Color, ColorResolver, Draft, V3 } from "./Commands";
import { normalizeHex } from "./Palette";
import type { Vec3 } from "./Raycast";
import { decodeCells, isSceneData, type SceneData } from "./Scene";
import type { Axis } from "./Tools";
import { EMPTY } from "./VoxelGrid";

/**
 * Architecture parts library: high-level drawing ops (roof, walls, window, door, pillar, beam, railing,
 * stairs, arch, crenels, lantern, stamp) plus the `pattern` fill used by `box` and `walls`.
 * Every op plans into the batch's `Draft` like the primitives in `Commands.ts` (one undo step, later ops
 * see earlier ones, out-of-grid cells are clipped). Pure: no DOM / Three.js.
 *
 * Only type imports from `Commands.ts` (it imports this file for dispatch, so no runtime cycle).
 */

/** A wall face, named by its outward normal. "Along" the face runs +x on z faces and +z on x faces. */
export type Face = "+x" | "-x" | "+z" | "-z";
export type PatternName = "brick" | "checker" | "stripes" | "noise";

/** Fill pattern options, shared by `box` and `walls`. */
export interface PatternOpts {
  /** brick: [brick, mortar, light?]; checker/stripes: cycles through colors; noise: [base, speckles...]. */
  pattern?: PatternName;
  /** Pattern colors. Omitted: derived from `color` by shading (e.g. brick = base, 0.84×, 1.12×). */
  colors?: Color[];
  /** Deterministic seed for brick highlights / noise (default 0). */
  seed?: number;
  /** noise: fraction of speckled cells (default 0.15); brick: fraction of light bricks (default 0.12). */
  density?: number;
  /** checker/stripes: cell size of one square / stripe (default 1). */
  scale?: number;
  /** stripes: axis the stripes advance along (default "y" = horizontal bands). */
  axis?: Axis;
}

export type RoofRamp = { base: Color; dark: Color; light: Color; cap: Color; ridge: Color; side: Color };

export type PatternBoxOp = { op: "box"; min: V3; max: V3; pattern: PatternName; color?: Color; hollow?: boolean } & PatternOpts;

export type PartOp =
  | {
      op: "roof"; min: [number, number]; max: [number, number]; y: number;
      style?: "hip" | "gable"; eave?: number | [number, number]; axis?: "x" | "z";
      steps?: number[]; hipSteps?: number[]; maxLayers?: number;
      ridge?: boolean; corners?: "upturned" | "flat"; pearl?: boolean | Color;
      color?: Color; ramp?: Partial<RoofRamp>;
    }
  | {
      op: "walls"; min: V3; max: V3; color?: Color;
      skirt?: boolean | number | { rows?: number; color?: Color; dark?: Color };
      top?: boolean | Color; posts?: boolean | Color; postTop?: Color;
      mottle?: number; floor?: boolean | Color;
    } & PatternOpts
  | {
      op: "window"; at: V3; face?: Face; size?: [number, number];
      style?: "lattice" | "slats" | "plain" | "round" | "open";
      frame?: Color; sill?: Color | null; fill?: Color; lattice?: Color;
    }
  | {
      op: "door"; at: V3; face?: Face; size?: [number, number];
      color?: Color; seam?: Color; studs?: Color | null; frame?: Color | null; lintel?: Color | null;
      plaque?: boolean | Color; plaqueText?: Color;
    }
  | { op: "pillar"; at: V3 | V3[]; height?: number; size?: number; color?: Color; base?: Color | false; capital?: Color | false }
  | { op: "beam"; from: V3; to: V3; color?: Color; dot?: Color | null; every?: number; offset?: number }
  | { op: "railing"; from: V3; to: V3; height?: number; color?: Color; post?: Color; every?: number }
  | { op: "stairs"; at: V3; face?: Face; steps?: number; width?: number; rise?: number; run?: number; color?: Color; edge?: Color; solid?: boolean }
  | { op: "arch"; min: V3; max: V3; axis?: "x" | "z"; color?: Color }
  | { op: "crenels"; min: V3; max: V3; color?: Color; every?: number; width?: number; sides?: Face[] }
  | { op: "lantern"; at: V3 | V3[]; size?: number; color?: Color; cap?: Color; tassel?: Color }
  | {
      op: "stamp"; scene: SceneData | string; at?: V3; rot?: 0 | 1 | 2 | 3; mirror?: "x" | "z";
      recolor?: Record<string, string | null>; reshade?: Record<string, string>; anchor?: "bbox" | "origin"; crop?: { min: V3; max: V3 };
    };

/** Every shade factor the parts library derives (roof/wall/pillar/pattern ramps); `stamp.reshade` remaps them all. */
export const SHADE_FACTORS = [0.45, 0.72, 0.74, 0.77, 0.84, 0.85, 0.86, 0.87, 0.93, 1.04, 1.12, 1.22, 1.42] as const;

export const PART_OP_NAMES = ["roof", "walls", "window", "door", "pillar", "beam", "railing", "stairs", "arch", "crenels", "lantern", "stamp"] as const;
export type PartOpName = (typeof PART_OP_NAMES)[number];

/** Default materials (match the waldo village palette). */
export const MATERIALS = {
  roof: "#3a9ab0", plaster: "#f6e8c8", pillar: "#d0402e", stone: "#a8a49a", skirt: "#9e978b", skirtD: "#86807a",
  wood: "#8a5a32", woodD: "#5e3a1e", woodL: "#b07a44", paper: "#f6e6b8", lattice: "#a8743e",
  door: "#c8342a", doorD: "#9a2a22", gold: "#f0c040", goldD: "#b8862a", red: "#d8342a", plaque: "#2a2a48",
  beam: "#2f6fa8", lantern: "#e0382c",
} as const;

/** A resolver that can also turn a cell value back into hex (needed to shade palette-index colors). */
export type HexAwareResolver = ColorResolver & { hexOf?: (cell: number) => string | undefined };

/** Attaches a cell → hex lookup to a resolver, so shade ramps work when colors are given as palette indices. */
export function withHexOf(resolve: ColorResolver, hexOf: (cell: number) => string | undefined): HexAwareResolver {
  return Object.assign((c: Color) => resolve(c), { hexOf });
}

// ---------- helpers ----------

const mod = (a: number, n: number) => ((a % n) + n) % n;
const v3 = (v: V3): Vec3 => (Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v);
const ri = (v: Vec3): Vec3 => ({ x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) });
function sorted(a: V3, b: V3): [Vec3, Vec3] {
  const p = ri(v3(a)), q = ri(v3(b));
  return [{ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), z: Math.min(p.z, q.z) }, { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y), z: Math.max(p.z, q.z) }];
}
function limit(name: string, n: number, max = 1024): number {
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${name} must be 0..${max}, got ${n}`);
  return Math.floor(n);
}

/** Multiplies each RGB channel by `f` (clamped) — the colors.js `shade`. */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function hexFor(c: Color, resolve: HexAwareResolver): string | null {
  if (typeof c === "string") return normalizeHex(c);
  const h = resolve.hexOf?.(resolve(c));
  return h ? normalizeHex(h) : null;
}
/** `c` shaded by `f`; if its hex can't be known (palette index without a hex lookup) the color itself. */
function shadeC(c: Color, f: number, resolve: HexAwareResolver): Color {
  const h = hexFor(c, resolve);
  return h ? shade(h, f) : c;
}

/** Roof shade ramp from one base color (colors.js `roofRamp`), with optional explicit overrides. */
export function roofRamp(c: Color, resolve: HexAwareResolver, over: Partial<RoofRamp> = {}): RoofRamp {
  return {
    base: over.base ?? c, dark: over.dark ?? shadeC(c, 0.74, resolve), light: over.light ?? shadeC(c, 1.22, resolve),
    cap: over.cap ?? shadeC(c, 1.42, resolve), ridge: over.ridge ?? shadeC(c, 0.45, resolve), side: over.side ?? shadeC(c, 0.86, resolve),
  };
}

/** Deterministic hash of a cell (+ seed) to [0, 1). */
export function hash3(x: number, y: number, z: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul((seed | 0) + 0x9e3779b9, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Cell value for each (x, y, z) of a pattern (colors resolved once). */
export function patternFn(o: PatternOpts & { color?: Color }, resolve: HexAwareResolver): (x: number, y: number, z: number) => number {
  const name = o.pattern;
  if (!name) throw new Error("pattern: missing pattern name");
  let colors = o.colors;
  if (!colors?.length) {
    if (o.color === undefined) throw new Error(`pattern "${name}": needs "colors" or "color"`);
    const c = o.color;
    colors =
      name === "brick" ? [c, shadeC(c, 0.84, resolve), shadeC(c, 1.12, resolve)]
      : name === "noise" ? [c, shadeC(c, 0.93, resolve), shadeC(c, 1.04, resolve)]
      : [c, shadeC(c, 0.85, resolve)];
  }
  const cells = colors.map((c) => resolve(c)), n = cells.length;
  const at = (i: number) => cells[Math.min(i, n - 1)]!;
  const seed = o.seed ?? 0, scale = Math.max(1, Math.floor(o.scale ?? 1));
  switch (name) {
    case "brick": {
      const light = o.density ?? 0.12;
      return (x, y, z) => {
        if (mod(y, 3) === 0) return at(1); // mortar course
        if (mod(x + z + (mod(y, 6) < 3 ? 0 : 3), 6) === 0) return at(1); // staggered head joints
        return n > 2 && hash3(x, y, z, seed) < light ? at(2) : at(0);
      };
    }
    case "checker":
      return (x, y, z) => at(mod(Math.floor(x / scale) + Math.floor(y / scale) + Math.floor(z / scale), n));
    case "stripes": {
      const ax = o.axis ?? "y";
      return (x, y, z) => at(mod(Math.floor((ax === "x" ? x : ax === "y" ? y : z) / scale), n));
    }
    case "noise": {
      const d = o.density ?? 0.15;
      return (x, y, z) => {
        if (n === 1) return at(0);
        const h = hash3(x, y, z, seed);
        return h < d ? at(1 + Math.floor((h / d) * (n - 1))) : at(0);
      };
    }
    default:
      throw new Error(`unknown pattern "${name as string}"; one of brick, checker, stripes, noise`);
  }
}

/** `box` with a `pattern` (dispatched from Commands' box case). */
export function patternBox(d: Draft, op: PatternBoxOp, resolve: HexAwareResolver): void {
  const [lo, hi] = sorted(op.min, op.max);
  const f = patternFn(op, resolve);
  const s = d.grid.size;
  for (let y = Math.max(0, lo.y); y <= Math.min(s - 1, hi.y); y++)
    for (let z = Math.max(0, lo.z); z <= Math.min(s - 1, hi.z); z++)
      for (let x = Math.max(0, lo.x); x <= Math.min(s - 1, hi.x); x++) {
        if (op.hollow && x > lo.x && x < hi.x && y > lo.y && y < hi.y && z > lo.z && z < hi.z) continue;
        d.set(x, y, z, f(x, y, z));
      }
}

/** Frame of a wall face: outward normal `n` and the in-plane "along" direction `a`. */
function faceFrame(face: Face = "+z"): { n: Vec3; a: Vec3 } {
  switch (face) {
    case "+z": return { n: { x: 0, y: 0, z: 1 }, a: { x: 1, y: 0, z: 0 } };
    case "-z": return { n: { x: 0, y: 0, z: -1 }, a: { x: 1, y: 0, z: 0 } };
    case "+x": return { n: { x: 1, y: 0, z: 0 }, a: { x: 0, y: 0, z: 1 } };
    case "-x": return { n: { x: -1, y: 0, z: 0 }, a: { x: 0, y: 0, z: 1 } };
    default: throw new Error(`face must be "+x", "-x", "+z" or "-z", got "${face as string}"`);
  }
}
/** Writer in face coordinates: (a along, y up, depth into the wall; -1 = one cell outside). */
function facePen(d: Draft, at: V3, face?: Face) {
  const o = ri(v3(at)), { n, a } = faceFrame(face);
  return (u: number, y: number, depth: number, v: number) =>
    d.set(o.x + a.x * u - n.x * depth, o.y + y, o.z + a.z * u - n.z * depth, v);
}

const list = (at: V3 | V3[]): Vec3[] =>
  (Array.isArray(at) && at.length > 0 && Array.isArray(at[0]) ? (at as V3[]) : [at as V3]).map((p) => ri(v3(p)));

function rasterLine(from: V3, to: V3): { p: Vec3; along: number }[] {
  const a = v3(from), b = v3(to);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const n = limit("line length", Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1), 4096);
  const dom: Axis = Math.abs(dx) >= Math.abs(dz) && Math.abs(dx) >= Math.abs(dy) ? "x" : Math.abs(dz) >= Math.abs(dy) ? "z" : "y";
  const out: { p: Vec3; along: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const p = ri({ x: a.x + (dx * i) / n, y: a.y + (dy * i) / n, z: a.z + (dz * i) / n });
    out.push({ p, along: p[dom] });
  }
  return out;
}

// ---------- roof ----------

/** Layer rectangles a roof op will draw (in local u = along ridge, v = across), plus ridge height. */
export function roofLayout(op: Extract<PartOp, { op: "roof" }>) {
  const [ex, ez] = typeof op.eave === "number" ? [op.eave, op.eave] : (op.eave ?? [2, 2]);
  const x0 = Math.min(op.min[0], op.max[0]) - ex, x1 = Math.max(op.min[0], op.max[0]) + ex;
  const z0 = Math.min(op.min[1], op.max[1]) - ez, z1 = Math.max(op.min[1], op.max[1]) + ez;
  const axis = op.axis ?? (x1 - x0 >= z1 - z0 ? "x" : "z");
  const [U0, U1, V0, V1] = axis === "x" ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
  const vs = op.steps ?? [2, 2, 1], us = op.style === "gable" ? [] : (op.hipSteps ?? [2, 1, 1]);
  const maxL = Math.min(op.maxLayers ?? 99, 256);
  limit("roof footprint", Math.max(U1 - U0, V1 - V0));
  const layers: { u0: number; u1: number; v0: number; v1: number; nu0: number; nu1: number; nv0: number; nv1: number; y: number }[] = [];
  let u0 = U0, u1 = U1, v0 = V0, v1 = V1;
  for (let k = 0; v1 - v0 >= 2 && u1 - u0 >= 2 && k < maxL; k++) {
    const su = op.style === "gable" ? 0 : Math.max(0, us[k] ?? 1), sv = Math.max(0, vs[k] ?? 1);
    const L = { u0, u1, v0, v1, nu0: u0 + su, nu1: u1 - su, nv0: v0 + sv, nv1: v1 - sv, y: op.y + k };
    layers.push(L);
    u0 = L.nu0; u1 = L.nu1; v0 = L.nv0; v1 = L.nv1;
  }
  const last = layers[layers.length - 1];
  const ridge = op.ridge !== false && !!last;
  return { axis, U0, U1, V0, V1, layers, ridgeY: ridge ? last!.y + 1 : null, topY: last ? last.y : op.y };
}

function roof(d: Draft, op: Extract<PartOp, { op: "roof" }>, resolve: HexAwareResolver) {
  const R = roofRamp(op.color ?? MATERIALS.roof, resolve, op.ramp);
  const c = { base: resolve(R.base), dark: resolve(R.dark), light: resolve(R.light), cap: resolve(R.cap), ridge: resolve(R.ridge), side: resolve(R.side) };
  const L = roofLayout(op);
  const put = (u: number, y: number, v: number, val: number) => (L.axis === "x" ? d.set(u, y, v, val) : d.set(v, y, u, val));
  L.layers.forEach((l, k) => {
    for (let v = l.v0; v <= l.v1; v++)
      for (let u = l.u0; u <= l.u1; u++) {
        const side = u < l.nu0 || u > l.nu1, fb = v < l.nv0 || v > l.nv1;
        let val: number;
        if (k === 0 && (u === l.u0 || u === l.u1 || v === l.v0 || v === l.v1)) val = mod(v === l.v0 || v === l.v1 ? u : v, 3) === 0 ? c.dark : c.cap; // eave caps
        else if (side && fb) val = c.ridge; // hip ridge
        else if (fb) val = mod(u, 3) === 0 ? c.dark : (v === l.nv0 - 1 || v === l.nv1 + 1) && k > 0 && mod(u, 3) === 1 ? c.light : c.base; // tile channels
        else if (side) val = mod(v, 3) === 0 ? c.dark : c.side;
        else val = c.base;
        put(u, l.y, v, val);
      }
  });
  if ((op.corners ?? "upturned") === "upturned" && L.layers.length)
    for (const [cu, cv, du, dv] of [[L.U0, L.V0, -1, -1], [L.U1, L.V0, 1, -1], [L.U0, L.V1, -1, 1], [L.U1, L.V1, 1, 1]] as const) {
      put(cu, op.y + 1, cv, c.cap); put(cu + du, op.y + 1, cv + dv, c.cap); put(cu + du, op.y + 2, cv + dv, c.ridge);
    }
  const last = L.layers[L.layers.length - 1];
  if (L.ridgeY !== null && last) {
    const vc = Math.floor((last.v0 + last.v1) / 2), yr = L.ridgeY;
    for (let u = last.u0; u <= last.u1; u++) { put(u, yr, vc, c.ridge); if (last.v1 - last.v0 >= 3) put(u, yr, vc + 1, c.ridge); }
    for (const [eu, du] of [[last.u0, -1], [last.u1, 1]] as const) { put(eu, yr + 1, vc, c.ridge); put(eu + du, yr + 2, vc, c.ridge); put(eu, yr + 2, vc, c.dark); }
    if (op.pearl) {
      const g = resolve(op.pearl === true ? MATERIALS.gold : op.pearl), um = Math.round((last.u0 + last.u1) / 2);
      put(um, yr + 1, vc, g); put(um, yr + 2, vc, g);
    }
  }
}

// ---------- walls / openings ----------

function walls(d: Draft, op: Extract<PartOp, { op: "walls" }>, resolve: HexAwareResolver) {
  const [lo, hi] = sorted(op.min, op.max);
  const base = op.color ?? MATERIALS.plaster;
  const pat = op.pattern ? patternFn({ ...op, color: base }, resolve) : null;
  const plain = resolve(base), mD = resolve(shadeC(base, 0.93, resolve)), mL = resolve(shadeC(base, 1.04, resolve));
  const mottle = op.mottle ?? 0.14, seed = op.seed ?? 0;
  const sk = op.skirt === undefined || op.skirt === false ? null
    : typeof op.skirt === "object" ? op.skirt : { rows: op.skirt === true ? 2 : op.skirt };
  const skRows = sk ? (sk.rows ?? 2) : 0;
  const skC = resolve(sk?.color ?? MATERIALS.skirt), skD = resolve(sk?.dark ?? (sk?.color !== undefined ? shadeC(sk.color, 0.87, resolve) : MATERIALS.skirtD));
  const top = op.top === undefined || op.top === true ? resolve(shadeC(base, 0.72, resolve)) : op.top === false ? null : resolve(op.top);
  const postC = op.posts === undefined || op.posts === false ? null : op.posts === true ? MATERIALS.pillar : op.posts;
  const post = postC === null ? null : resolve(postC), postTop = postC === null ? null : resolve(op.postTop ?? shadeC(postC, 0.74, resolve));
  const floor = op.floor === undefined || op.floor === false ? null : resolve(op.floor === true ? MATERIALS.stone : op.floor);
  const s = d.grid.size;
  for (let y = Math.max(0, lo.y); y <= Math.min(s - 1, hi.y); y++)
    for (let z = Math.max(0, lo.z); z <= Math.min(s - 1, hi.z); z++)
      for (let x = Math.max(0, lo.x); x <= Math.min(s - 1, hi.x); x++) {
        const ex = x === lo.x || x === hi.x, ez = z === lo.z || z === hi.z;
        if (!ex && !ez) { if (floor !== null && y === lo.y) d.set(x, y, z, floor); continue; }
        let v: number;
        if (post !== null && ex && ez) v = y === hi.y ? postTop! : post;
        else if (y < lo.y + skRows) v = mod(x + z + y, 4) === 0 ? skD : skC;
        else if (top !== null && y === hi.y) v = top;
        else if (pat) v = pat(x, y, z);
        else { const h = hash3(x, y, z, seed); v = h < mottle * 0.7 ? mD : h < mottle ? mL : plain; }
        d.set(x, y, z, v);
      }
}

function windowOp(d: Draft, op: Extract<PartOp, { op: "window" }>, resolve: HexAwareResolver) {
  const [w, h] = (op.size ?? [4, 5]).map((n) => limit("window size", n, 256)) as [number, number];
  const pen = facePen(d, op.at, op.face);
  const style = op.style ?? "lattice";
  const frame = resolve(op.frame ?? MATERIALS.wood), fill = resolve(op.fill ?? MATERIALS.paper), lat = resolve(op.lattice ?? MATERIALS.lattice);
  const sill = op.sill === null ? null : resolve(op.sill ?? MATERIALS.woodL);
  const round = style === "round";
  const inside = (a: number, y: number) => {
    if (a < 0 || a >= w || y < 0 || y >= h) return false;
    if (!round) return true;
    const dx = (a + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
    return dx * dx + dy * dy <= 1.05;
  };
  for (let a = -1; a <= w; a++)
    for (let y = -1; y <= h; y++) {
      if (inside(a, y)) {
        pen(a, y, 0, EMPTY);
        if (style === "open") continue;
        pen(a, y, 1, style === "lattice" || round ? (mod(a + y, 2) === 0 ? lat : fill) : style === "slats" ? (mod(a, 2) === 0 ? lat : fill) : fill);
      } else if (!round) pen(a, y, 0, y === -1 && sill !== null ? sill : frame);
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([p, q]) => inside(a + p!, y + q!))) pen(a, y, 0, frame);
    }
  if (sill !== null && !round) for (let a = -1; a <= w; a++) pen(a, -1, -1, sill);
}

function door(d: Draft, op: Extract<PartOp, { op: "door" }>, resolve: HexAwareResolver) {
  const [w, h] = (op.size ?? [4, 9]).map((n) => limit("door size", n, 256)) as [number, number];
  const pen = facePen(d, op.at, op.face);
  const leaf = op.color ?? MATERIALS.door;
  const cLeaf = resolve(leaf), cSeam = resolve(op.seam ?? (op.color === undefined ? MATERIALS.doorD : shadeC(leaf, 0.77, resolve)));
  const studs = op.studs === null ? null : resolve(op.studs ?? MATERIALS.gold);
  const frame = op.frame === null ? null : resolve(op.frame ?? MATERIALS.red), lintel = op.lintel === null ? null : resolve(op.lintel ?? MATERIALS.woodD);
  const seam = Math.max(0, Math.floor(w / 2) - 1);
  for (let a = 0; a < w; a++)
    for (let y = 0; y < h; y++) {
      pen(a, y, 0, EMPTY);
      pen(a, y, 1, a === seam && w > 1 ? cSeam : studs !== null && (a === 0 || a === w - 1) && mod(y, 3) === 1 ? studs : cLeaf);
    }
  if (frame !== null) for (let y = 0; y <= h; y++) for (const a of [-1, w]) pen(a, y, 0, studs !== null && mod(y, 3) === 1 ? studs : frame);
  if (lintel !== null) for (let a = -1; a <= w; a++) pen(a, h, 0, lintel);
  if (op.plaque) {
    const pc = resolve(op.plaque === true ? MATERIALS.plaque : op.plaque), tc = resolve(op.plaqueText ?? MATERIALS.gold);
    const mid = (a: number) => (w % 2 === 0 ? a === w / 2 - 1 || a === w / 2 : a === (w - 1) / 2);
    for (let a = 0; a < w; a++) pen(a, h + 1, -1, mid(a) ? tc : pc);
  }
}

// ---------- structure ----------

function pillar(d: Draft, op: Extract<PartOp, { op: "pillar" }>, resolve: HexAwareResolver) {
  const H = limit("pillar height", op.height ?? 8), S = Math.max(1, limit("pillar size", op.size ?? 1));
  const col = op.color ?? MATERIALS.pillar;
  const cCol = resolve(col);
  const cBase = op.base === false ? null : resolve(op.base ?? MATERIALS.stone);
  const cCap = op.capital === false ? null : resolve(op.capital ?? shadeC(col, 0.74, resolve));
  for (const p of list(op.at))
    for (let i = 0; i < H; i++) {
      const v = i === 0 && cBase !== null && H > 1 ? cBase : i === H - 1 && cCap !== null ? cCap : cCol;
      for (let dz = 0; dz < S; dz++) for (let dx = 0; dx < S; dx++) d.set(p.x + dx, p.y + i, p.z + dz, v);
    }
}

function beam(d: Draft, op: Extract<PartOp, { op: "beam" }>, resolve: HexAwareResolver) {
  const c = resolve(op.color ?? MATERIALS.beam), dot = op.dot === null ? null : resolve(op.dot ?? MATERIALS.gold);
  const every = Math.max(1, Math.floor(op.every ?? 3)), off = op.offset ?? 0;
  for (const { p, along } of rasterLine(op.from, op.to)) d.set(p.x, p.y, p.z, dot !== null && mod(along - off, every) === 0 ? dot : c);
}

function railing(d: Draft, op: Extract<PartOp, { op: "railing" }>, resolve: HexAwareResolver) {
  const H = Math.max(1, limit("railing height", op.height ?? 2)), col = op.color ?? MATERIALS.pillar;
  const c = resolve(col), post = resolve(op.post ?? shadeC(col, 0.74, resolve)), every = Math.max(1, Math.floor(op.every ?? 2));
  for (const { p, along } of rasterLine(op.from, op.to)) {
    d.set(p.x, p.y + H - 1, p.z, c);
    if (mod(along, every) === 0) for (let y = 0; y < H - 1; y++) d.set(p.x, p.y + y, p.z, post);
  }
}

function stairs(d: Draft, op: Extract<PartOp, { op: "stairs" }>, resolve: HexAwareResolver) {
  const n = limit("stairs steps", op.steps ?? 3), W = limit("stairs width", op.width ?? 3);
  const rise = Math.max(1, limit("stairs rise", op.rise ?? 1)), run = Math.max(1, limit("stairs run", op.run ?? 1));
  const pen = facePen(d, op.at, op.face);
  const c = resolve(op.color ?? MATERIALS.stone), edge = op.edge === undefined ? null : resolve(op.edge);
  const solid = op.solid !== false;
  for (let i = 0; i < n; i++) {
    const top = (i + 1) * rise - 1;
    for (let r = 0; r < run; r++)
      for (let y = solid ? 0 : top - rise + 1; y <= top; y++)
        for (let a = 0; a < W; a++) pen(a, y, i * run + r, edge !== null && r === 0 && y === top ? edge : c);
  }
}

function arch(d: Draft, op: Extract<PartOp, { op: "arch" }>, resolve: HexAwareResolver) {
  const [lo, hi] = sorted(op.min, op.max);
  const axis = op.axis ?? "z", across: "x" | "z" = axis === "z" ? "x" : "z";
  const a0 = lo[across], w = hi[across] - a0 + 1, r = w / 2;
  const crown = Math.min(Math.ceil(r), hi.y - lo.y + 1), spring = hi.y - crown;
  const v = op.color === undefined ? EMPTY : resolve(op.color);
  const s = d.grid.size;
  for (let y = Math.max(0, lo.y); y <= Math.min(s - 1, hi.y); y++)
    for (let z = Math.max(0, lo.z); z <= Math.min(s - 1, hi.z); z++)
      for (let x = Math.max(0, lo.x); x <= Math.min(s - 1, hi.x); x++) {
        const a = across === "x" ? x : z;
        const dx = (a + 0.5 - (a0 + r)) / r, dy = (y - spring) / (crown + 0.5);
        if (y <= spring || dx * dx + dy * dy <= 1) d.set(x, y, z, v);
      }
}

function crenels(d: Draft, op: Extract<PartOp, { op: "crenels" }>, resolve: HexAwareResolver) {
  const [lo, hi] = sorted(op.min, op.max);
  const c = resolve(op.color ?? "#b8ae9a"), every = Math.max(1, Math.floor(op.every ?? 2)), mw = Math.max(1, Math.floor(op.width ?? 1));
  const sides = new Set<Face>(op.sides ?? ["+x", "-x", "+z", "-z"]);
  for (const f of sides) faceFrame(f); // validate
  for (let y = lo.y; y <= hi.y; y++) {
    for (let x = lo.x; x <= hi.x; x++) {
      if (mod(x - lo.x, every) >= mw) continue;
      if (sides.has("-z")) d.set(x, y, lo.z, c);
      if (sides.has("+z")) d.set(x, y, hi.z, c);
    }
    for (let z = lo.z; z <= hi.z; z++) {
      if (mod(z - lo.z, every) >= mw) continue;
      if (sides.has("-x")) d.set(lo.x, y, z, c);
      if (sides.has("+x")) d.set(hi.x, y, z, c);
    }
  }
}

function lantern(d: Draft, op: Extract<PartOp, { op: "lantern" }>, resolve: HexAwareResolver) {
  const n = Math.max(1, limit("lantern size", op.size ?? 2));
  const cap = resolve(op.cap ?? MATERIALS.goldD), body = resolve(op.color ?? MATERIALS.lantern), tassel = resolve(op.tassel ?? MATERIALS.gold);
  for (const p of list(op.at)) {
    d.set(p.x, p.y, p.z, cap);
    for (let i = 1; i <= n; i++) d.set(p.x, p.y - i, p.z, body);
    d.set(p.x, p.y - n - 1, p.z, tassel);
  }
}

// ---------- stamp ----------

/**
 * Where each occupied source cell lands. Transform order: crop → mirror → rotate (quarter turns about +Y,
 * right-handed: rot 1 turns the source's front (+z) to face +x) → translate so the frame's min corner is `at`.
 * The frame is the source's bounding box (anchor "bbox", default) or its whole grid (anchor "origin").
 */
export function stampCells(op: Extract<PartOp, { op: "stamp" }>): { x: number; y: number; z: number; value: number }[] {
  const scene = op.scene;
  if (typeof scene === "string") throw new Error(`stamp: scene "${scene}" is a name; the API resolves names, core needs SceneData`);
  if (!isSceneData(scene)) throw new Error("stamp: scene must be { version: 1|2, size, palette, data }");
  const S = scene.size, cells = decodeCells(scene.data, S ** 3);
  const [clo, chi] = op.crop ? sorted(op.crop.min, op.crop.max) : [{ x: 0, y: 0, z: 0 }, { x: S - 1, y: S - 1, z: S - 1 }];
  const src: { x: number; y: number; z: number; value: number }[] = [];
  const bmin = { x: Infinity, y: Infinity, z: Infinity }, bmax = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < cells.length; i++) {
    const value = cells[i]!;
    if (value === EMPTY) continue;
    const x = i % S, y = Math.floor(i / (S * S)), z = Math.floor(i / S) % S;
    if (x < clo.x || x > chi.x || y < clo.y || y > chi.y || z < clo.z || z > chi.z) continue;
    src.push({ x, y, z, value });
    bmin.x = Math.min(bmin.x, x); bmin.y = Math.min(bmin.y, y); bmin.z = Math.min(bmin.z, z);
    bmax.x = Math.max(bmax.x, x); bmax.y = Math.max(bmax.y, y); bmax.z = Math.max(bmax.z, z);
  }
  if (!src.length) return [];
  const [f0, f1] = (op.anchor ?? "bbox") === "origin" ? [{ x: 0, y: 0, z: 0 }, { x: S - 1, y: S - 1, z: S - 1 }] : [bmin, bmax];
  const at = ri(v3(op.at ?? [0, 0, 0])), rot = mod(Math.round(op.rot ?? 0), 4);
  if (op.mirror !== undefined && op.mirror !== "x" && op.mirror !== "z") throw new Error(`stamp: mirror must be "x" or "z"`);
  return src.map((p) => {
    let lx = p.x - f0.x, lz = p.z - f0.z, W = f1.x - f0.x, D = f1.z - f0.z;
    if (op.mirror === "x") lx = W - lx;
    if (op.mirror === "z") lz = D - lz;
    for (let k = 0; k < rot; k++) { [lx, lz, W, D] = [lz, W - lx, D, W]; }
    return { x: at.x + lx, y: at.y + p.y - f0.y, z: at.z + lz, value: p.value };
  });
}

function stamp(d: Draft, op: Extract<PartOp, { op: "stamp" }>, resolve: HexAwareResolver) {
  const scene = op.scene as SceneData;
  const recolor = new Map<string, string | null>();
  for (const [k, v] of Object.entries(op.recolor ?? {})) {
    const from = normalizeHex(k);
    if (!from) throw new Error(`stamp: recolor key "${k}" is not a hex color`);
    recolor.set(from, v);
  }
  for (const [k, v] of Object.entries(op.reshade ?? {})) {
    const from = normalizeHex(k), to = normalizeHex(v);
    if (!from || !to) throw new Error(`stamp: reshade needs hex colors, got "${k}": "${v}"`);
    if (!recolor.has(from)) recolor.set(from, to);
    for (const f of SHADE_FACTORS) { const sf = shade(from, f); if (!recolor.has(sf)) recolor.set(sf, shade(to, f)); }
  }
  const map = new Map<number, number | null>();
  const valueOf = (cell: number): number | null => {
    let v = map.get(cell);
    if (v !== undefined) return v;
    const hex = scene.palette[cell - 1];
    if (!hex) throw new Error(`stamp: scene has no palette color for cell value ${cell}`);
    const n = normalizeHex(hex) ?? hex;
    const to = recolor.has(n) ? recolor.get(n)! : n;
    v = to === null ? null : resolve(to);
    map.set(cell, v);
    return v;
  };
  for (const p of stampCells(op)) {
    const v = valueOf(p.value);
    if (v !== null) d.set(p.x, p.y, p.z, v);
  }
}

// ---------- dispatch ----------

const PART_SET = new Set<string>(PART_OP_NAMES);
export function isPartOp(op: { op: string }): op is PartOp {
  return PART_SET.has(op.op);
}

/** Applies one parts-library op to a draft. Throws on malformed input. */
export function applyPartOp(d: Draft, op: PartOp, resolve: HexAwareResolver): void {
  switch (op.op) {
    case "roof": return roof(d, op, resolve);
    case "walls": return walls(d, op, resolve);
    case "window": return windowOp(d, op, resolve);
    case "door": return door(d, op, resolve);
    case "pillar": return pillar(d, op, resolve);
    case "beam": return beam(d, op, resolve);
    case "railing": return railing(d, op, resolve);
    case "stairs": return stairs(d, op, resolve);
    case "arch": return arch(d, op, resolve);
    case "crenels": return crenels(d, op, resolve);
    case "lantern": return lantern(d, op, resolve);
    case "stamp": return stamp(d, op, resolve);
  }
}
