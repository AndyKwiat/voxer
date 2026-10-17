/**
 * Recipe files: the pure half (format, validation, slot references, the `build(ctx)` context, op
 * batching). No file system, no page — `scripts/lib/recipe-build.ts` loads files and drives Voxer with
 * these. Format reference: `recipes/README.md`.
 */
import { checkAnchor, checkAnchorName, type Anchor } from "../../src/core/Anchors";
import { OP_NAMES } from "../../src/core/Commands";
import { MESH_FORMATS, type ExportOptions, type MeshFormat } from "../../src/core/MeshExport";
import type { LintOptions } from "../../src/core/Lint";
import { hash3 } from "../../src/core/Parts";
import { checkHex, checkSlotName, shade } from "../../src/core/Slots";
import { isViewName, VIEW_NAMES } from "../../src/render/Views";

/** Untyped op as written in a recipe (validated by name here, fully by core when run). */
export type RecipeOp = { op: string; [k: string]: unknown };

/** `{ base, shades }` (shade name → factor or hex), or just the base hex. */
export type SlotSpec = string | { base: string; shades?: Record<string, number | string> };

export interface SheetSpec {
  views?: string[];
  tile?: number;
  columns?: number;
  /** Scale person beside the model: true (8 cells) or a height. */
  figure?: boolean | number;
}

export type ExportSpec = MeshFormat | (ExportOptions & { format: MeshFormat });

export type BuildResult = void | Iterable<RecipeOp> | AsyncIterable<RecipeOp> | { ops?: Iterable<RecipeOp>; anchors?: Record<string, Anchor> };

export interface Recipe {
  name: string;
  /** Grid size (default 32, max 256). */
  size?: number;
  description?: string;
  /** Starting palette for new_scene (default: Voxer's 32 defaults). */
  palette?: string[];
  /** Defined before any op runs, in order; ops reference them as `"slot:roof"` / `"slot:roof.dark"`. */
  slots?: Record<string, SlotSpec>;
  ops?: RecipeOp[];
  build?: (ctx: RecipeContext) => BuildResult | Promise<BuildResult>;
  anchors?: Record<string, Anchor>;
  /** Variant name → slot recolors; each becomes `<name>@<variant>.json` (via make_variant). */
  variants?: Record<string, Record<string, string>>;
  /** Mesh outputs: "glb" | "obj" | "json" or export_mesh options with a format. */
  export?: ExportSpec[];
  /** Lint options, or false to skip lint. */
  lint?: boolean | LintOptions;
  /** Snapshot sheet options, or false for no sheet. */
  sheet?: boolean | SheetSpec;
  /** Free-form data copied to the manifest. */
  meta?: Record<string, unknown>;
}

/** A validated recipe plus where it came from. */
export interface LoadedRecipe extends Recipe {
  size: number;
  /** Absolute path of the file it was loaded from (relative stamp / scene paths resolve against it). */
  source?: string;
}

const KEYS = new Set(["name", "size", "description", "palette", "slots", "ops", "build", "anchors", "variants", "export", "lint", "sheet", "meta"]);
export const RECIPE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_SIZE = 256;
const OPS = new Set<string>(OP_NAMES);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Looks like a single recipe (as opposed to an array / record of them). */
export function isRecipeLike(v: unknown): boolean {
  return isObj(v) && (Array.isArray(v.ops) || typeof v.build === "function");
}

/**
 * A module's exports (or parsed JSON) → validated recipes. Accepts: the default export (or the JSON
 * value) being a recipe, an array of recipes, or a record `{name: recipe}` (key = default name); without
 * a default export, every named export that is a recipe or an array of them. A lone recipe without a
 * name takes `fallbackName` (the file's base name).
 */
export function normalizeRecipes(mod: unknown, fallbackName: string, source?: string): LoadedRecipe[] {
  const where = source ?? fallbackName;
  const out: LoadedRecipe[] = [];
  const add = (raw: unknown, name: string | undefined, label: string) => out.push(validateRecipe(raw, name, `${where}: ${label}`, source));
  const collect = (v: unknown, label: string, name?: string): boolean => {
    if (isRecipeLike(v)) { add(v, name, label); return true; }
    if (Array.isArray(v)) {
      if (!v.length || !v.every(isRecipeLike)) return false;
      v.forEach((r, i) => add(r, undefined, `${label}[${i}]`));
      return true;
    }
    if (isObj(v) && Object.keys(v).length && Object.values(v).every(isRecipeLike)) {
      for (const [k, r] of Object.entries(v)) add(r, k, `${label}.${k}`);
      return true;
    }
    return false;
  };
  const m = mod as Record<string, unknown> | null;
  const isModule = isObj(m) && "default" in m;
  if (isModule || !isObj(m) || isRecipeLike(m) || Array.isArray(mod)) {
    const v = isModule ? m!.default : mod;
    if (!collect(v, isModule ? "default export" : "recipe", fallbackName)) throw new Error(`${where}: not a recipe, array or record of recipes (a recipe has ops: [...] or build(ctx))`);
  } else {
    // module namespace without a default: named exports
    for (const [k, v] of Object.entries(m)) collect(v, `export ${k}`, k);
    // a single recipe file with only named exports keeps each export's own name or the export name
  }
  const seen = new Set<string>();
  for (const r of out) {
    if (seen.has(r.name)) throw new Error(`${where}: two recipes are named "${r.name}"`);
    seen.add(r.name);
  }
  return out;
}

/** Validates one recipe object (throws with every problem found). `name` is used when it has none. */
export function validateRecipe(raw: unknown, name: string | undefined, where: string, source?: string): LoadedRecipe {
  if (!isObj(raw)) throw new Error(`${where}: recipe must be an object`);
  const errs: string[] = [];
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) errs.push(`unknown key "${k}" (allowed: ${[...KEYS].join(", ")})`);
  const r = { ...raw } as unknown as LoadedRecipe;
  r.name = (raw.name as string | undefined) ?? name ?? "";
  if (typeof r.name !== "string" || !RECIPE_NAME.test(r.name)) errs.push(`name must match ${RECIPE_NAME} (got ${JSON.stringify(r.name)})`);
  r.size = (raw.size as number | undefined) ?? 32;
  if (!Number.isInteger(r.size) || r.size < 1 || r.size > MAX_SIZE) errs.push(`size must be an integer 1..${MAX_SIZE}`);
  const hasOps = raw.ops !== undefined, hasBuild = raw.build !== undefined;
  if (hasOps === hasBuild) errs.push("give exactly one of ops: [...] or build(ctx)");
  if (hasOps && !Array.isArray(raw.ops)) errs.push("ops must be an array");
  if (hasBuild && typeof raw.build !== "function") errs.push("build must be a function (ctx) => ops");
  if (Array.isArray(raw.ops)) raw.ops.forEach((o, i) => { const e = checkOpShape(o); if (e) errs.push(`op ${i}: ${e}`); });
  if (raw.description !== undefined && typeof raw.description !== "string") errs.push("description must be a string");
  if (raw.palette !== undefined) {
    if (!Array.isArray(raw.palette) || !raw.palette.length) errs.push("palette must be a non-empty array of hex colors");
    else raw.palette.forEach((c, i) => { try { checkHex(c); } catch { errs.push(`palette[${i}]: invalid color ${JSON.stringify(c)}`); } });
  }
  const slotNames = new Set<string>();
  if (raw.slots !== undefined) {
    if (!isObj(raw.slots)) errs.push("slots must be an object { name: { base, shades? } | \"#hex\" }");
    else for (const [k, s] of Object.entries(raw.slots)) {
      try { checkSlotName(k); slotNames.add(k); } catch (e) { errs.push((e as Error).message); }
      const base = typeof s === "string" ? s : isObj(s) ? s.base : undefined;
      try { checkHex(base); } catch { errs.push(`slot ${k}: base must be "#rrggbb" (got ${JSON.stringify(base)})`); }
      if (isObj(s)) {
        for (const kk of Object.keys(s)) if (kk !== "base" && kk !== "shades") errs.push(`slot ${k}: unknown key "${kk}" (base, shades)`);
        if (s.shades !== undefined && !isObj(s.shades)) errs.push(`slot ${k}: shades must be { name: factor | "#hex" }`);
        else for (const [sh, v] of Object.entries((s.shades as object) ?? {})) {
          try { checkSlotName(sh, "shade"); } catch (e) { errs.push(`slot ${k}: ${(e as Error).message}`); }
          if (typeof v === "string") { try { checkHex(v); } catch { errs.push(`slot ${k}.${sh}: invalid color ${JSON.stringify(v)}`); } }
          else if (typeof v !== "number" || !(v >= 0 && v <= 16)) errs.push(`slot ${k}.${sh}: factor must be a number 0..16 or a hex`);
        }
      } else if (typeof s !== "string") errs.push(`slot ${k}: expected { base, shades? } or "#hex"`);
    }
  }
  if (raw.anchors !== undefined) {
    if (!isObj(raw.anchors)) errs.push("anchors must be an object { name: { x, y, z, dir?, note? } }");
    else for (const [k, a] of Object.entries(raw.anchors)) {
      try { checkAnchor(checkAnchorName(k), a); } catch (e) { errs.push((e as Error).message); }
    }
  }
  if (raw.variants !== undefined) {
    if (!isObj(raw.variants)) errs.push("variants must be an object { variant: { slot: \"#hex\" } }");
    else for (const [v, changes] of Object.entries(raw.variants)) {
      if (!RECIPE_NAME.test(v)) errs.push(`variant name must match ${RECIPE_NAME} (got ${JSON.stringify(v)})`);
      if (!isObj(changes) || !Object.keys(changes).length) { errs.push(`variant ${v}: expected { slot: "#hex", … }`); continue; }
      for (const [s, hex] of Object.entries(changes)) {
        if (!slotNames.has(s)) errs.push(`variant ${v}: no slot "${s}"${slotNames.size ? ` (slots: ${[...slotNames].join(", ")})` : " (define it under slots)"}`);
        try { checkHex(hex); } catch { errs.push(`variant ${v}.${s}: invalid color ${JSON.stringify(hex)}`); }
      }
    }
  }
  if (raw.export !== undefined) {
    if (!Array.isArray(raw.export)) errs.push(`export must be an array, e.g. ["glb"]`);
    else raw.export.forEach((e, i) => { const f = typeof e === "string" ? e : isObj(e) ? e.format : undefined; if (!MESH_FORMATS.includes(f as MeshFormat)) errs.push(`export[${i}]: format must be one of ${MESH_FORMATS.join(", ")}`); });
  }
  if (raw.lint !== undefined && typeof raw.lint !== "boolean" && !isObj(raw.lint)) errs.push("lint must be false or lint options");
  if (raw.sheet !== undefined && typeof raw.sheet !== "boolean") {
    if (!isObj(raw.sheet)) errs.push("sheet must be false or { views?, tile?, columns?, figure? }");
    else for (const v of (raw.sheet.views as unknown[] | undefined) ?? []) if (typeof v !== "string" || !isViewName(v)) errs.push(`sheet: unknown view ${JSON.stringify(v)} (one of ${VIEW_NAMES.join(", ")})`);
  }
  if (errs.length) throw new Error(`${where}${r.name ? ` (${r.name})` : ""}: ${errs.join("; ")}`);
  if (source) r.source = source;
  return r;
}

/** Problem with an op's shape, or null. Only checks it's `{op: <known name>}`; core validates the rest. */
export function checkOpShape(o: unknown): string | null {
  if (!isObj(o) || typeof o.op !== "string") return `expected { op: "...", … }, got ${JSON.stringify(o)?.slice(0, 60)}`;
  if (!OPS.has(o.op)) return `unknown op "${o.op}" (one of ${OP_NAMES.join(", ")})`;
  if (o.op === "stamp") {
    const hasScene = o.scene !== undefined, hasRecipe = o.recipe !== undefined;
    if (hasScene === hasRecipe) return "stamp needs exactly one of recipe: \"name\" or scene";
    if (hasRecipe && typeof o.recipe !== "string") return "stamp recipe must be a string (a recipe name, or \"./file.js\" / \"./file.js#name\")";
    if (o.anchorPrefix !== undefined && (!hasRecipe || typeof o.anchorPrefix !== "string")) return "stamp anchorPrefix must be a string and needs recipe:";
  }
  return null;
}

// ---------- slot references ----------

/** `slot:<slot>` or `slot:<slot>.<shade>`. */
export const SLOT_REF = /^slot:([A-Za-z][A-Za-z0-9_-]*)(?:\.([A-Za-z][A-Za-z0-9_-]*))?$/;

/** Slot name → shade name → hex (the colors define_slot returned, `base` included). */
export type SlotColors = Record<string, Record<string, string>>;

/** The hex for a `slot:` reference (throws on unknown slot / shade). */
export function slotColor(colors: SlotColors, slot: string, shadeName = "base"): string {
  const s = colors[slot];
  if (!s) throw new Error(`unknown slot "${slot}"${Object.keys(colors).length ? ` (slots: ${Object.keys(colors).join(", ")})` : " (no slots defined)"}`);
  const hex = s[shadeName];
  if (!hex) throw new Error(`slot "${slot}" has no shade "${shadeName}" (shades: ${Object.keys(s).join(", ")})`);
  return hex;
}

/**
 * Deep copy of `v` with every `"slot:name[.shade]"` string — values and object keys (e.g. stamp
 * `reshade`/`recolor` maps) — replaced by its hex. Errors name the path, e.g. `op 3 (roof).ramp.dark`.
 */
export function resolveSlotRefs<T>(v: T, colors: SlotColors, path = ""): T {
  const fix = (s: string, p: string): string => {
    if (!s.startsWith("slot:")) return s;
    const m = SLOT_REF.exec(s);
    if (!m) throw new Error(`${p}: bad slot reference "${s}" (use "slot:name" or "slot:name.shade")`);
    try { return slotColor(colors, m[1]!, m[2]); } catch (e) { throw new Error(`${p}: ${(e as Error).message}`); }
  };
  const walk = (x: unknown, p: string): unknown => {
    if (typeof x === "string") return fix(x, p);
    if (Array.isArray(x)) {
      // fast path for big voxel lists: only copy when something changes
      let out: unknown[] | null = null;
      for (let i = 0; i < x.length; i++) {
        const y = walk(x[i], `${p}[${i}]`);
        if (y !== x[i] && !out) out = x.slice(0, i);
        if (out) out.push(y);
      }
      return out ?? x;
    }
    if (isObj(x)) {
      const o: Record<string, unknown> = {};
      let changed = false;
      for (const [k, val] of Object.entries(x)) {
        const kk = fix(k, `${p}.${k}`), y = walk(val, `${p}.${k}`);
        if (kk !== k || y !== val) changed = true;
        o[kk] = y;
      }
      return changed ? o : x;
    }
    return x;
  };
  return walk(v, path) as T;
}

/** Normalized slot spec → define_slot params. */
export function slotParams(name: string, spec: SlotSpec): { name: string; base: string; shades?: Record<string, number | string> } {
  return typeof spec === "string" ? { name, base: spec } : { name, base: spec.base, ...(spec.shades ? { shades: spec.shades } : {}) };
}

// ---------- build(ctx) ----------

/** Deterministic RNG in [0, 1) (mulberry32, the same as the waldo recipes' `rng`). */
export function rng(seed = 1): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Color = number | string;
type V3 = [number, number, number];

export interface RecipeContext {
  name: string;
  size: number;
  /** Slot colors: `ctx.slots.roof.dark` (= the hex `"slot:roof.dark"` resolves to). */
  slots: SlotColors;
  /** `ctx.slot("roof", "dark")`, throws on unknown names. */
  slot(name: string, shade?: string): string;
  rng: typeof rng;
  /** Multiplies RGB by f (the parts library / colors.js `shade`). */
  shade(hex: string, f: number): string;
  /** Deterministic cell hash → [0, 1). */
  hash3(x: number, y: number, z: number, seed?: number): number;
  /** Appends ops (in order with `set` calls). */
  add(...ops: RecipeOp[]): void;
  /** Sparse voxel painting like waldo's G: coordinates are rounded; null erases. Collected into `set` ops. */
  set(x: number, y: number, z: number, color: Color | null): void;
  box(min: V3, max: V3, color: Color): void;
  /** Sets an anchor (merged over the recipe's `anchors`). */
  anchor(name: string, a: Anchor): void;
}

/**
 * Runs a recipe's `build(ctx)` (or takes its `ops`) and resolves slot references. Ops added through the
 * context come first in call order; ops the function returns or yields are appended in order too.
 */
export async function expandRecipe(r: Recipe, colors: SlotColors): Promise<{ ops: RecipeOp[]; anchors: Record<string, Anchor> }> {
  const anchors: Record<string, Anchor> = { ...(r.anchors ?? {}) };
  let ops: RecipeOp[];
  if (r.build) {
    ops = [];
    let pending: [number, number, number, Color | null][] | null = null;
    const flush = () => { if (pending?.length) ops.push({ op: "set", voxels: pending }); pending = null; };
    const add = (...os: RecipeOp[]) => { flush(); for (const o of os) ops.push(o); };
    const size = r.size ?? 32;
    const ctx: RecipeContext = {
      name: r.name, size, slots: colors,
      slot: (n, s) => slotColor(colors, n, s),
      rng, shade, hash3, add,
      set(x, y, z, c) { (pending ??= []).push([Math.round(x), Math.round(y), Math.round(z), c]); },
      box(min, max, color) { add({ op: "box", min, max, color }); },
      anchor(name, a) { anchors[checkAnchorName(name)] = checkAnchor(name, a); },
    };
    const res = await r.build(ctx);
    if (res && typeof res === "object") {
      const it = (Symbol.iterator in res || Symbol.asyncIterator in res) ? (res as Iterable<RecipeOp>) : (res as { ops?: Iterable<RecipeOp> }).ops;
      if (it) for await (const o of it as AsyncIterable<RecipeOp> & Iterable<RecipeOp>) add(o);
      const ra = !(Symbol.iterator in res) ? (res as { anchors?: Record<string, Anchor> }).anchors : undefined;
      for (const [k, a] of Object.entries(ra ?? {})) ctx.anchor(k, a);
    }
    flush();
  } else ops = [...(r.ops ?? [])];
  ops.forEach((o, i) => { const e = checkOpShape(o); if (e) throw new Error(`op ${i}: ${e}`); });
  return { ops: ops.map((o, i) => resolveSlotRefs(o, colors, `op ${i} (${o.op})`)), anchors: resolveSlotRefs(anchors, colors, "anchors") };
}

// ---------- batching / stamps ----------

/**
 * Splits ops into `run` batches: at most `maxOps` ops each, and `set` ops with more than `maxVoxels`
 * voxels are cut into several. Order is preserved.
 */
export function batchOps(ops: readonly RecipeOp[], maxOps = 400, maxVoxels = 50_000): RecipeOp[][] {
  const out: RecipeOp[][] = [];
  let cur: RecipeOp[] = [], weight = 0;
  const push = (o: RecipeOp, w: number) => {
    if (cur.length && (cur.length >= maxOps || weight + w > maxVoxels)) { out.push(cur); cur = []; weight = 0; }
    cur.push(o); weight += w;
  };
  for (const o of ops) {
    const vox = o.op === "set" && Array.isArray(o.voxels) ? (o.voxels as unknown[]) : null;
    if (vox && vox.length > maxVoxels) for (let i = 0; i < vox.length; i += maxVoxels) push({ ...o, voxels: vox.slice(i, i + maxVoxels) }, Math.min(maxVoxels, vox.length - i));
    else push(o, vox ? vox.length : 1);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** `recipe` refs of `stamp` ops (unique, in order). */
export function stampRecipeRefs(ops: readonly RecipeOp[]): string[] {
  const s = new Set<string>();
  for (const o of ops) if (o.op === "stamp" && typeof o.recipe === "string") s.add(o.recipe);
  return [...s];
}

/**
 * Where a stamped scene's anchors land: the same transform `stamp` applies to cells (core
 * `Parts.stampCells`: frame = source bbox, or the whole grid with `anchor: "origin"`; mirror, then quarter
 * turns about Y; frame min → `at`), with `dir` turned along. Names get `prefix`.
 */
export function stampAnchors(
  anchors: Record<string, Anchor>, src: { bbox: Bbox | null; size: number },
  op: { at?: unknown; rot?: unknown; mirror?: unknown; anchor?: unknown; [k: string]: unknown }, prefix: string,
): Record<string, Anchor> {
  const out: Record<string, Anchor> = {};
  if (!src.bbox && op.anchor !== "origin") return out;
  const [f0, f1] = op.anchor === "origin" ? [{ x: 0, y: 0, z: 0 }, { x: src.size - 1, y: src.size - 1, z: src.size - 1 }] : [src.bbox!.min, src.bbox!.max];
  const a = Array.isArray(op.at) ? op.at as number[] : isObj(op.at) ? [op.at.x, op.at.y, op.at.z] as number[] : [0, 0, 0];
  const at = a.map((n) => Math.round(Number(n) || 0));
  const rot = ((Math.round(Number(op.rot) || 0) % 4) + 4) % 4;
  const turn: Record<string, string> = { "+z": "+x", "+x": "-z", "-z": "-x", "-x": "+z" };
  for (const [name, p] of Object.entries(anchors)) {
    let lx = p.x - f0.x, lz = p.z - f0.z, W = f1.x - f0.x, D = f1.z - f0.z;
    let dir = p.dir as string | undefined;
    if (op.mirror === "x") { lx = W - lx; if (dir === "+x" || dir === "-x") dir = dir === "+x" ? "-x" : "+x"; }
    if (op.mirror === "z") { lz = D - lz; if (dir === "+z" || dir === "-z") dir = dir === "+z" ? "-z" : "+z"; }
    for (let k = 0; k < rot; k++) { [lx, lz, W, D] = [lz, W - lx, D, W]; if (dir && turn[dir]) dir = turn[dir]; }
    const q: Anchor = { x: at[0]! + lx, y: at[1]! + p.y - f0.y, z: at[2]! + lz };
    if (dir) q.dir = dir as Anchor["dir"];
    if (p.note) q.note = p.note;
    out[checkAnchorName(prefix + name)] = q;
  }
  return out;
}

/** Splits `"./house.js#home2"` into a file and a recipe name; plain `"house"` is just a name. */
export function parseRecipeRef(ref: string): { file?: string; name?: string } {
  const hash = ref.lastIndexOf("#");
  const [file, name] = hash >= 0 ? [ref.slice(0, hash), ref.slice(hash + 1)] : [ref, ""];
  if (/[\\/]/.test(file) || /\.(m?[jt]s|json)$/.test(file)) return { file, name: name || undefined };
  return { name: ref };
}

// ---------- output ----------

export interface Bbox { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
export const fmtBbox = (b: Bbox | null | undefined) => (b ? `${b.min.x},${b.min.y},${b.min.z}..${b.max.x},${b.max.y},${b.max.z}` : "empty");

/** One compact line per model: `house   5234 vox  bbox 4,0,9..35,21,31  2 warn  812 ms`. */
export function summaryLine(m: { name: string; voxels: number; bbox: Bbox | null; warnings: string[]; errors: string[]; ms: number }, width = 16): string {
  const status = m.errors.length ? `ERROR ${m.errors[0]}` : m.warnings.length ? `${m.warnings.length} warn` : "ok";
  return `${m.name.padEnd(width)} ${String(m.voxels).padStart(7)} vox  bbox ${fmtBbox(m.bbox).padEnd(22)} ${String(Math.round(m.ms)).padStart(6)} ms  ${status}`;
}
