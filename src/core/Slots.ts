import { hexToRgb, MAX_COLORS, normalizeHex, rgbToHex } from "./Palette";
import type { SceneData } from "./Scene";

/**
 * Named material slots: a slot ("roof", "wall", …) owns a few palette entries that form a shade ramp of
 * one base color (base ×1, dark ×0.74, light ×1.22, …). Recoloring the slot re-derives every entry from a
 * new base, and because voxels store palette indices, every voxel painted with the ramp follows.
 * Pure math + validation; `Editor` holds the state.
 */

/** One palette entry of a slot: its index and its multiplicative factor relative to the slot's base. */
export interface SlotShade {
  index: number;
  factor: number;
}

/** A slot as stored in a scene. `shades` always has a `base` entry with factor 1. */
export interface SlotData {
  /** The color the ramp is derived from (palette entries may differ by ±1 per channel to stay unique). */
  base: string;
  shades: Record<string, SlotShade>;
}

export type Slots = Record<string, SlotData>;

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export function checkSlotName(name: unknown, what = "slot"): string {
  if (typeof name !== "string" || !NAME.test(name)) throw new Error(`${what} name must match ${NAME} (got ${JSON.stringify(name)})`);
  return name;
}

export function checkHex(hex: unknown): string {
  const n = typeof hex === "string" ? normalizeHex(hex) : null;
  if (!n) throw new Error(`invalid color ${JSON.stringify(hex)} (use "#rrggbb")`);
  return n;
}

function checkFactor(f: unknown, what: string): number {
  if (typeof f !== "number" || !Number.isFinite(f) || f < 0 || f > 16) throw new Error(`${what}: factor must be a number in 0..16`);
  return f;
}

/** Multiplies each RGB channel by `f` (rounded, clamped) — the same `shade` the game recipes use. */
export function shade(hex: string, f: number): string {
  const c = hexToRgb(hex);
  if (!c) throw new Error(`invalid color ${hex}`);
  return rgbToHex({ r: c.r * f, g: c.g * f, b: c.b * f });
}

/** Best scalar factor (least squares over RGB) so that `shade(base, f) ≈ color`. Rounded to 3 decimals. */
export function fitFactor(color: string, base: string): number {
  const c = hexToRgb(color), b = hexToRgb(base);
  if (!c || !b) throw new Error(`invalid color ${!c ? color : base}`);
  const bb = b.r * b.r + b.g * b.g + b.b * b.b;
  if (bb === 0) return 1;
  return Math.round(((c.r * b.r + c.g * b.g + c.b * b.b) / bb) * 1e3) / 1e3;
}

/** Hexes of a ramp: `base` first, then each named shade as `shade(base, factor)`. */
export function deriveRamp(base: string, factors: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = { base: checkHex(base) };
  for (const [k, f] of Object.entries(factors)) if (k !== "base") out[k] = shade(base, f);
  return out;
}

/**
 * `hex`, or the closest variant (±1, ±2… on one or more channels) not in `taken`. Slot colors are kept
 * unique in the palette so that painting with a returned hex always resolves to the slot's own entry.
 */
export function uniqueHex(hex: string, taken: ReadonlySet<string>): string {
  const n = checkHex(hex);
  if (!taken.has(n)) return n;
  const c = hexToRgb(n)!;
  const steps: [number, number, number][] = [];
  for (let d = 1; d <= 8; d++)
    for (const s of [1, -1])
      steps.push([0, s * d, 0], [s * d, 0, 0], [0, 0, s * d], [s * d, s * d, s * d]);
  for (const [dr, dg, db] of steps) {
    const r = c.r + dr, g = c.g + dg, b = c.b + db;
    if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) continue;
    const h = rgbToHex({ r, g, b });
    if (!taken.has(h)) return h;
  }
  return n;
}

/** Palette indices owned by slots (optionally excluding one slot). */
export function slotIndices(slots: Slots, except?: string): Set<number> {
  const s = new Set<number>();
  for (const [name, slot] of Object.entries(slots)) if (name !== except) for (const sh of Object.values(slot.shades)) s.add(sh.index);
  return s;
}

/**
 * Writes a ramp into palette entries: each shade's color is `explicit[name]` or `shade(base, factor)`,
 * nudged to be unique among the palette's other entries. Returns the new palette (input is not mutated).
 */
export function writeRamp(palette: readonly string[], slot: SlotData, explicit: Record<string, string> = {}): string[] {
  const next = [...palette];
  const own = new Set(Object.values(slot.shades).map((s) => s.index));
  const taken = new Set(next.filter((_, i) => !own.has(i)));
  for (const [name, sh] of Object.entries(slot.shades)) {
    if (sh.index < 0 || sh.index >= next.length) throw new RangeError(`slot shade ${name}: no palette entry ${sh.index}`);
    const hex = uniqueHex(explicit[name] ?? shade(slot.base, sh.factor), taken);
    taken.add(hex);
    next[sh.index] = hex;
  }
  return next;
}

/** Recolors one slot to a new base: returns the new palette and slot record. Pure. */
export function recolorSlot(palette: readonly string[], slots: Slots, name: string, base: string): { palette: string[]; slot: SlotData } {
  const old = slots[name];
  if (!old) throw new Error(`no slot "${name}"${Object.keys(slots).length ? `; slots: ${Object.keys(slots).join(", ")}` : ""}`);
  const slot: SlotData = { base: checkHex(base), shades: old.shades };
  return { palette: writeRamp(palette, slot), slot };
}

/**
 * A copy of `scene` with some slots recolored (`{roof: "#e8b830"}`): only the palette and slot bases
 * change; voxel data, anchors etc. are shared. Unknown slot names throw. Pure.
 */
export function variantScene(scene: SceneData, changes: Record<string, string>): SceneData {
  if (!changes || typeof changes !== "object" || !Object.keys(changes).length) throw new Error("variant: give { slots: { name: \"#rrggbb\", … } }");
  let palette = [...scene.palette];
  const slots: Slots = { ...(scene.slots ?? {}) };
  for (const [name, hex] of Object.entries(changes)) {
    const r = recolorSlot(palette, slots, name, hex);
    palette = r.palette;
    slots[name] = r.slot;
  }
  return { ...scene, palette, slots };
}

/** Compact view for agents: `{roof: {base, colors: {base: "#…", dark: "#…"}}}` with the current palette hexes. */
export function slotSummary(slots: Slots, palette: readonly string[]) {
  const out: Record<string, { base: string; colors: Record<string, string>; factors: Record<string, number> }> = {};
  for (const [name, s] of Object.entries(slots)) {
    const colors: Record<string, string> = {}, factors: Record<string, number> = {};
    for (const [k, sh] of Object.entries(s.shades)) { colors[k] = palette[sh.index] ?? "?"; factors[k] = sh.factor; }
    out[name] = { base: s.base, colors, factors };
  }
  return out;
}

/** Validates `slots` from a scene file against its palette length (throws on malformed data). */
export function parseSlots(raw: unknown, paletteLength: number): Slots {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("scene slots must be an object");
  const out: Slots = {}, used = new Set<number>();
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    checkSlotName(name);
    const s = v as { base?: unknown; shades?: unknown };
    if (!s || typeof s !== "object" || !s.shades || typeof s.shades !== "object") throw new Error(`slot ${name}: expected { base, shades }`);
    const shades: Record<string, SlotShade> = {};
    for (const [k, sh] of Object.entries(s.shades as Record<string, { index?: unknown; factor?: unknown }>)) {
      checkSlotName(k, "shade");
      const i = sh?.index;
      if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= paletteLength) throw new Error(`slot ${name}.${k}: bad palette index ${JSON.stringify(i)}`);
      if (used.has(i)) throw new Error(`slot ${name}.${k}: palette index ${i} is already in a slot`);
      used.add(i);
      shades[k] = { index: i, factor: checkFactor(sh.factor, `slot ${name}.${k}`) };
    }
    if (!shades.base) throw new Error(`slot ${name}: needs a "base" shade`);
    out[name] = { base: checkHex(s.base), shades };
  }
  return out;
}

export interface DefineSlotResult {
  palette: string[];
  slot: SlotData;
}

/**
 * Plans `define_slot {name, base, shades}`: shades map names to a factor (`dark: 0.74`) or an explicit hex
 * (its factor is fitted so recolors follow the base). Reuses the indices of a previous slot of the same name
 * by shade name and appends the rest. Pure: returns the new palette + slot.
 */
export function planDefineSlot(palette: readonly string[], slots: Slots, name: string, base: string, shades: Record<string, number | string> = {}): DefineSlotResult {
  checkSlotName(name);
  const b = checkHex(base);
  const prev = slots[name];
  const taken = slotIndices(slots, name);
  const next = [...palette];
  const out: SlotData = { base: b, shades: {} };
  const explicit: Record<string, string> = {};
  const entries: [string, number | string][] = [["base", 1], ...Object.entries(shades).filter(([k]) => k !== "base")];
  for (const [k, v] of entries) {
    checkSlotName(k, "shade");
    let factor: number;
    if (typeof v === "string") { explicit[k] = checkHex(v); factor = fitFactor(explicit[k], b); }
    else factor = checkFactor(v, `shade ${k}`);
    const reuse = prev?.shades[k]?.index;
    const index = reuse !== undefined && reuse < next.length && !taken.has(reuse) ? reuse : next.push("#000000") - 1;
    out.shades[k] = { index, factor };
  }
  if (next.length > MAX_COLORS) throw new Error(`palette full: slot "${name}" needs ${entries.length} entries, palette has ${palette.length}/${MAX_COLORS}`);
  return { palette: writeRamp(next, out, explicit), slot: out };
}

/**
 * Plans `define_slot {name, colors}`: adopts existing palette entries (hex or index; first = base) as a
 * slot without changing the palette. Shade factors are fitted to the base.
 */
export function planAdoptSlot(palette: readonly string[], slots: Slots, name: string, colors: (string | number)[], names?: string[]): SlotData {
  checkSlotName(name);
  if (!Array.isArray(colors) || !colors.length) throw new Error("define_slot: colors must be a non-empty array");
  const taken = slotIndices(slots, name);
  const idx = colors.map((c) => {
    const i = typeof c === "number" ? c : palette.indexOf(checkHex(c));
    if (!Number.isInteger(i) || i < 0 || i >= palette.length) throw new Error(`define_slot: ${JSON.stringify(c)} is not in the palette`);
    if (taken.has(i)) throw new Error(`define_slot: palette entry ${i} (${palette[i]}) already belongs to another slot`);
    return i;
  });
  if (new Set(idx).size !== idx.length) throw new Error("define_slot: colors repeat a palette entry");
  const base = palette[idx[0]!]!;
  const slot: SlotData = { base, shades: {} };
  idx.forEach((i, n) => {
    const k = n === 0 ? "base" : checkSlotName(names?.[n] ?? `shade${n}`, "shade");
    if (slot.shades[k]) throw new Error(`define_slot: shade name "${k}" repeats`);
    slot.shades[k] = { index: i, factor: n === 0 ? 1 : fitFactor(palette[i]!, base) };
  });
  return slot;
}
