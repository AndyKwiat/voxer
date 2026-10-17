import type { Op, V3 } from "./Commands";
import type { Vec3 } from "./Raycast";

/**
 * Named anchors: points of interest a game needs (`door`, `roof_top`, `seat`, `pivot`) stored with the
 * scene instead of being hard-coded. An anchor is a cell, an optional facing direction and a note.
 * Pure validation + how batch ops move them; `Editor` holds the state.
 */

export const ANCHOR_DIRS = ["+x", "-x", "+y", "-y", "+z", "-z"] as const;
export type AnchorDir = (typeof ANCHOR_DIRS)[number];

export interface Anchor {
  x: number;
  y: number;
  z: number;
  dir?: AnchorDir;
  note?: string;
}

export type Anchors = Record<string, Anchor>;

const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/;
const LIMIT = 4096;

export function checkAnchorName(name: unknown): string {
  if (typeof name !== "string" || !NAME.test(name)) throw new Error(`anchor name must match ${NAME} (got ${JSON.stringify(name)})`);
  return name;
}

/** Validated, normalized copy. Coordinates are integer cells; they may lie outside the grid (e.g. a spot in front of the model). */
export function checkAnchor(name: string, a: unknown): Anchor {
  const v = a as Partial<Anchor> | null;
  if (!v || typeof v !== "object") throw new Error(`anchor ${name}: expected { x, y, z, dir?, note? }`);
  const out: Anchor = { x: 0, y: 0, z: 0 };
  for (const k of ["x", "y", "z"] as const) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isInteger(n) || Math.abs(n) > LIMIT) throw new Error(`anchor ${name}: ${k} must be an integer cell coordinate`);
    out[k] = n;
  }
  if (v.dir !== undefined && v.dir !== null) {
    if (!(ANCHOR_DIRS as readonly string[]).includes(v.dir)) throw new Error(`anchor ${name}: dir must be one of ${ANCHOR_DIRS.join(", ")}`);
    out.dir = v.dir;
  }
  if (v.note !== undefined && v.note !== null) {
    if (typeof v.note !== "string" || v.note.length > 200) throw new Error(`anchor ${name}: note must be a string (≤200 chars)`);
    if (v.note) out.note = v.note;
  }
  return out;
}

/** Validates `anchors` from a scene file. */
export function parseAnchors(raw: unknown): Anchors {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("scene anchors must be an object");
  const out: Anchors = {};
  for (const [name, a] of Object.entries(raw as Record<string, unknown>)) out[checkAnchorName(name)] = checkAnchor(name, a);
  return out;
}

/** Unit vector of a direction. */
export function dirVector(dir: AnchorDir): Vec3 {
  const s = dir[0] === "-" ? -1 : 1, a = dir[1];
  return { x: a === "x" ? s : 0, y: a === "y" ? s : 0, z: a === "z" ? s : 0 };
}

const vec = (v: V3): Vec3 => (Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v);

/**
 * Anchor positions after a batch of ops. Only a moving `translate` moves anchors: one without a box moves
 * all of them, one with `min`/`max` moves those inside the box; `copy: true` leaves them. `mirror`,
 * `clear` and drawing ops don't touch anchors. Returns the anchors that moved (empty when none).
 */
export function anchorMoves(anchors: Anchors, ops: readonly Op[]): { name: string; from: Anchor; to: Anchor }[] {
  const cur = new Map(Object.entries(anchors).map(([k, a]) => [k, { ...a }]));
  const start = new Map(Object.entries(anchors));
  for (const op of ops) {
    if (op?.op !== "translate" || op.copy) continue;
    const o = vec(op.offset);
    const d = { x: Math.round(o.x), y: Math.round(o.y), z: Math.round(o.z) };
    let lo: Vec3 | undefined, hi: Vec3 | undefined;
    if (op.min && op.max) {
      const a = vec(op.min), b = vec(op.max);
      lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
      hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
    }
    for (const a of cur.values()) {
      if (lo && hi && (a.x < lo.x || a.x > hi.x || a.y < lo.y || a.y > hi.y || a.z < lo.z || a.z > hi.z)) continue;
      a.x += d.x; a.y += d.y; a.z += d.z;
    }
  }
  const out: { name: string; from: Anchor; to: Anchor }[] = [];
  for (const [k, a] of cur) {
    const s = start.get(k)!;
    if (a.x !== s.x || a.y !== s.y || a.z !== s.z) out.push({ name: k, from: s, to: a });
  }
  return out;
}
