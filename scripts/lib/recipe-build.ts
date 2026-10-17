/**
 * Recipe builder shared by `scripts/build.ts` (CLI) and the MCP `build_recipe` tool: loads recipe files,
 * replays each recipe through a Voxer host (`recipe-host.ts`) and writes the outputs:
 *
 *   <out>/<name>.json            scene (v2 when it has slots/anchors)
 *   <out>/<name>@<variant>.json  one per `variants` entry (make_variant)
 *   <out>/<name>.<glb|obj|json>  meshes (`export` / --export), variants too: <name>@<variant>.glb
 *   <out>/sheets/<name>.png      snapshot sheet (best-effort, retried smaller; needs a page)
 *   <out>/manifest.json          name → files, size, voxels, bbox, anchors, slots, warnings (merged with an existing one)
 *
 * Per recipe: new_scene {size, palette} → define_slot (in order) → expand ops (build(ctx), slot refs)
 * → build any stamped recipes first → run (batched) → set_anchor → lint → serialize.
 */
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { Anchor } from "../../src/core/Anchors";
import { DEFAULT_COLORS } from "../../src/core/Palette";
import type { SceneData } from "../../src/core/Scene";
import { readSceneFile, writeSceneFile } from "../../server/SceneFile";
import { degradedNote, snapshotWithRetry } from "../../mcp/snapshot";
import {
  batchOps, expandRecipe, stampAnchors, normalizeRecipes, parseRecipeRef, slotParams, stampRecipeRefs, summaryLine,
  type Bbox, type ExportSpec, type LoadedRecipe, type RecipeOp, type SlotColors,
} from "./recipe";
import type { RecipeHost } from "./recipe-host";

export const RECIPE_EXTS = [".js", ".mjs", ".ts", ".json"];
export const DEFAULT_VIEWS = ["front", "iso", "iso_left", "top"];
export const DEFAULT_TILE = 300;

// ---------- loading ----------

/** Loads one recipe file. JS/TS modules are imported fresh each call (edits are picked up; their own imports are cached by Bun). */
export async function loadRecipeFile(path: string): Promise<LoadedRecipe[]> {
  const abs = resolve(path), ext = extname(abs).toLowerCase();
  if (!RECIPE_EXTS.includes(ext)) throw new Error(`${abs}: recipe files are ${RECIPE_EXTS.join(" / ")}`);
  if (!existsSync(abs)) throw new Error(`no recipe file at ${abs}`);
  const base = basename(abs, extname(abs));
  if (ext === ".json") {
    let v: unknown;
    try { v = JSON.parse(await Bun.file(abs).text()); } catch (e) { throw new Error(`${abs}: invalid JSON: ${(e as Error).message}`); }
    return normalizeRecipes(v, base, abs);
  }
  const mod = await import(`${abs}?v=${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
  return normalizeRecipes(mod, base, abs);
}

/** Recipe files under a directory (recursive; skips `out`, `node_modules`, dot- and `_`-prefixed entries, README). */
export function recipeFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    if (e.startsWith(".") || e.startsWith("_") || e === "node_modules" || e === "out" || /^readme/i.test(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...recipeFilesIn(p));
    else if (RECIPE_EXTS.includes(extname(e).toLowerCase()) && !e.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/**
 * Files and directories → recipes. A file given explicitly must contain recipes; files found in a
 * directory that export none (helper modules) are skipped. Duplicate names across files are an error.
 */
export async function loadRecipes(paths: string[]): Promise<LoadedRecipe[]> {
  const all: LoadedRecipe[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) throw new Error(`no such file or directory: ${abs}`);
    if (statSync(abs).isDirectory()) {
      for (const f of recipeFilesIn(abs)) all.push(...(await loadRecipeFile(f).catch((e) => { if (/not a recipe/.test((e as Error).message)) return []; throw e; })));
    } else {
      const rs = await loadRecipeFile(abs);
      if (!rs.length) throw new Error(`${abs}: exports no recipes`);
      all.push(...rs);
    }
  }
  const seen = new Map<string, string | undefined>();
  for (const r of all) {
    if (seen.has(r.name)) throw new Error(`recipe "${r.name}" is defined twice (${seen.get(r.name)} and ${r.source})`);
    seen.set(r.name, r.source);
  }
  return all;
}

// ---------- building ----------

export interface BuildOptions {
  /** Output directory (created). */
  outDir: string;
  /** Only build (and write) these recipe names; stamped recipes are still built as needed. */
  only?: string[];
  /** Snapshot sheets (default true; skipped when the host can't render). */
  sheet?: boolean;
  /** Scale figure on sheets: true (8 cells) or a height. Overrides the recipe's sheet.figure. */
  figure?: boolean | number;
  /** Sheet views (default per recipe, else front, iso, iso_left, top). */
  views?: string[];
  tile?: number;
  /** Extra mesh formats for every recipe (added to each recipe's `export`). */
  export?: string[];
  /** Per-attempt snapshot timeout (default 30 s). */
  snapshotTimeoutMs?: number;
  /** Write manifest.json (default true). */
  manifest?: boolean;
  log?: (line: string) => void;
}

export interface ModelResult {
  name: string;
  source?: string;
  size: number;
  voxels: number;
  bbox: Bbox | null;
  anchors: Record<string, Anchor>;
  slots: Record<string, { base: string; colors: Record<string, string> }>;
  /** Absolute paths. */
  files: { scene?: string; sheet?: string; variants: Record<string, string>; meshes: Record<string, string> };
  /** From the write report(s) ("run: …") and lint ("lint: …"). */
  warnings: string[];
  /** Informational: degraded / skipped sheet, run notes. */
  notes: string[];
  errors: string[];
  ms: number;
}

export interface BuildSummary {
  models: ModelResult[];
  manifest?: string;
  outDir: string;
  ok: boolean;
  /** Ok, and no warnings. */
  clean: boolean;
  /** One line per model + a total line. */
  text: string;
}

interface Built {
  scene: SceneData;
  warnings: string[];
  notes: string[];
  info: { count: number; bbox: Bbox | null };
  anchors: Record<string, Anchor>;
  slots: ModelResult["slots"];
}

const RUN_TIMEOUT = 600_000;

export class RecipeBuilder {
  private built = new Map<LoadedRecipe, Built>();
  private stack: LoadedRecipe[] = [];
  private files = new Map<string, Promise<LoadedRecipe[]>>();
  /** Name of the scene currently loaded in the host. */
  loaded: string | null = null;

  constructor(private host: RecipeHost, private registry: LoadedRecipe[]) {}

  /** Builds `r` in the host (cached per recipe object); leaves it loaded. */
  async build(r: LoadedRecipe): Promise<Built> {
    const hit = this.built.get(r);
    if (hit) {
      if (this.loaded !== r.name) { await this.host.rpc("load", { scene: hit.scene }); this.loaded = r.name; }
      return hit;
    }
    if (this.stack.includes(r)) throw new Error(`stamp cycle: ${[...this.stack, r].map((x) => x.name).join(" → ")}`);
    this.stack.push(r);
    try {
      let colors = await this.setup(r);
      let { ops, anchors } = await expandRecipe(r, colors);
      // Stamped recipes are built first (that replaces the scene), then this one is set up again.
      const deps = await Promise.all(stampRecipeRefs(ops).map(async (ref) => [ref, await this.resolveRef(ref, r)] as const));
      const pending = deps.filter(([, d]) => !this.built.has(d));
      if (pending.length) {
        for (const [, d] of pending) await this.build(d);
        const again = await this.setup(r);
        if (JSON.stringify(again) !== JSON.stringify(colors)) { colors = again; ({ ops, anchors } = await expandRecipe(r, colors)); }
      }
      const byRef = new Map(deps.map(([ref, d]) => [ref, this.built.get(d)!]));
      // anchors of stamped recipes (with anchorPrefix) land where the stamp puts them; the recipe's own win
      const carried: Record<string, Anchor> = {};
      for (const o of ops) if (o.op === "stamp" && typeof o.recipe === "string" && typeof o.anchorPrefix === "string") {
        const d = byRef.get(o.recipe)!;
        Object.assign(carried, stampAnchors(d.anchors, { bbox: d.info.bbox, size: d.scene.size }, o, o.anchorPrefix));
      }
      anchors = { ...carried, ...anchors };
      ops = await Promise.all(ops.map((o) => this.resolveStamp(o, byRef, r)));

      const warnings: string[] = [], notes: string[] = [];
      const batches = batchOps(ops);
      for (const [i, b] of batches.entries()) {
        const res = await this.host.rpc("run", { ops: b }, RUN_TIMEOUT);
        const tag = batches.length > 1 ? `run (batch ${i + 1}/${batches.length})` : "run";
        for (const w of res.report?.warnings ?? []) warnings.push(`${tag}: ${w}`);
        for (const n of res.report?.notes ?? []) notes.push(`${tag}: ${n}`);
      }
      for (const [name, a] of Object.entries(anchors)) await this.host.rpc("set_anchor", { name, ...a });
      if (r.lint !== false) {
        const l = await this.host.rpc("lint", typeof r.lint === "object" ? r.lint : {}, RUN_TIMEOUT);
        for (const w of l.warnings ?? []) warnings.push(`lint: ${w}`);
      }
      const info = await this.host.rpc("info");
      const scene: SceneData = await this.host.rpc("serialize");
      const slots: ModelResult["slots"] = {};
      for (const [k, v] of Object.entries((info.slots ?? {}) as Record<string, { base: string; colors: Record<string, string> }>)) slots[k] = { base: v.base, colors: v.colors };
      const b: Built = { scene, warnings, notes, info: { count: info.count, bbox: info.bbox }, anchors: info.anchors ?? anchors, slots };
      this.built.set(r, b);
      this.loaded = r.name;
      return b;
    } finally {
      this.stack.pop();
    }
  }

  /**
   * new_scene + slots → slot colors. Always passes a palette (new_scene keeps the previous one otherwise),
   * so a recipe gets the same palette — and the same slot hexes — whatever was built before it.
   */
  private async setup(r: LoadedRecipe): Promise<SlotColors> {
    await this.host.rpc("new_scene", { size: r.size, palette: r.palette ?? [...DEFAULT_COLORS] });
    this.loaded = null;
    const colors: SlotColors = {};
    for (const [name, spec] of Object.entries(r.slots ?? {})) {
      const res = await this.host.rpc("define_slot", slotParams(name, spec));
      colors[name] = res.colors;
    }
    return colors;
  }

  /** A stamp `recipe` reference → the recipe: a name in the registry (or a sibling `<name>.js/.ts/.json`), or `./file.js[#name]`. */
  async resolveRef(ref: string, from: LoadedRecipe): Promise<LoadedRecipe> {
    const { file, name } = parseRecipeRef(ref);
    const dir = from.source ? dirname(from.source) : process.cwd();
    if (file) {
      const abs = resolve(dir, file);
      const rs = await this.load(abs);
      const hit = name ? rs.find((x) => x.name === name) : rs.length === 1 ? rs[0] : undefined;
      if (!hit) throw new Error(`stamp recipe "${ref}": ${name ? `no recipe "${name}" in ${abs}` : `${abs} has ${rs.length} recipes; use "${file}#name"`} (has: ${rs.map((x) => x.name).join(", ")})`);
      return hit;
    }
    const inReg = this.registry.find((x) => x.name === name);
    if (inReg) return inReg;
    for (const ext of RECIPE_EXTS) {
      const abs = join(dir, name + ext);
      if (existsSync(abs)) { const hit = (await this.load(abs)).find((x) => x.name === name); if (hit) return hit; }
    }
    throw new Error(`stamp recipe "${ref}": no recipe with that name (loaded: ${this.registry.map((x) => x.name).join(", ") || "none"}; also looked for ${name}.js/.ts/.json next to ${from.source ?? "the cwd"})`);
  }

  private load(abs: string): Promise<LoadedRecipe[]> {
    let p = this.files.get(abs);
    if (!p) {
      // reuse recipe objects already in the registry so their builds are shared
      p = loadRecipeFile(abs).then((rs) => rs.map((x) => this.registry.find((y) => y.source === abs && y.name === x.name) ?? x));
      this.files.set(abs, p);
    }
    return p;
  }

  /** `stamp {recipe}` → `stamp {scene}`; `stamp {scene: "./file.json"}` → the file's scene. */
  private async resolveStamp(o: RecipeOp, built: Map<string, Built>, from: LoadedRecipe): Promise<RecipeOp> {
    if (o.op !== "stamp") return o;
    if (typeof o.recipe === "string") { const { recipe, anchorPrefix: _, ...rest } = o; return { ...rest, scene: built.get(recipe)!.scene }; }
    if (typeof o.scene === "string" && (/[\\/]/.test(o.scene) || o.scene.endsWith(".json"))) {
      const abs = resolve(from.source ? dirname(from.source) : process.cwd(), o.scene);
      return { ...o, scene: await readSceneFile(abs) };
    }
    return o;
  }

  /** Builds a recipe and writes its outputs. Never throws: errors land in the result. */
  async output(r: LoadedRecipe, opts: BuildOptions): Promise<ModelResult> {
    const t0 = performance.now();
    const m: ModelResult = { name: r.name, source: r.source, size: r.size, voxels: 0, bbox: null, anchors: {}, slots: {}, files: { variants: {}, meshes: {} }, warnings: [], notes: [], errors: [], ms: 0 };
    const out = resolve(opts.outDir);
    try {
      const b = await this.build(r);
      Object.assign(m, { voxels: b.info.count, bbox: b.info.bbox, anchors: b.anchors, slots: b.slots });
      m.warnings.push(...b.warnings);
      m.notes.push(...b.notes);
      m.files.scene = await writeSceneFile(join(out, `${r.name}.json`), b.scene);

      // sheet (base scene is loaded)
      const sheetOn = opts.sheet !== false && r.sheet !== false;
      if (sheetOn && !this.host.canSnapshot) m.notes.push("sheet: skipped (no page; run with a browser to render sheets)");
      else if (sheetOn) {
        const spec = typeof r.sheet === "object" ? r.sheet : {};
        const fig = opts.figure ?? spec.figure;
        const params: Record<string, unknown> = { views: opts.views ?? spec.views ?? DEFAULT_VIEWS, tile: opts.tile ?? spec.tile ?? DEFAULT_TILE };
        if (spec.columns) params.columns = spec.columns;
        if (fig) params.figure = fig === true ? 8 : fig;
        try {
          const run = await snapshotWithRetry((p, t) => this.host.rpc("snapshot", p, t), params, { timeoutMs: opts.snapshotTimeoutMs ?? 30_000, recover: this.host.recover, log: this.host.log });
          const path = join(out, "sheets", `${r.name}.png`);
          mkdirSync(dirname(path), { recursive: true });
          await Bun.write(path, Buffer.from(run.result.data, "base64"));
          m.files.sheet = path;
          const note = degradedNote(run);
          if (note) m.notes.push(`sheet:${note}`);
        } catch (e) {
          m.notes.push(`sheet: failed (${(e as Error).message})`);
        }
      }

      // variants
      const variantScenes: [string, SceneData][] = [];
      for (const [v, changes] of Object.entries(r.variants ?? {})) {
        const res = await this.host.rpc("make_variant", { slots: changes });
        m.files.variants[v] = await writeSceneFile(join(out, `${r.name}@${v}.json`), res.scene);
        variantScenes.push([v, res.scene]);
      }

      // meshes
      const specs = exportSpecs(r.export, opts.export);
      if (specs.length) {
        const targets: [string, SceneData | null][] = [[r.name, null], ...variantScenes.map(([v, s]) => [`${r.name}@${v}`, s] as [string, SceneData])];
        for (const [file, scene] of targets) {
          if (scene) { await this.host.rpc("load", { scene }); this.loaded = file; }
          for (const s of specs) {
            const res = await this.host.rpc("export_mesh", { name: r.name, ...s }, RUN_TIMEOUT);
            const path = join(out, `${file}.${extOf(res.filename, s.format)}`);
            await Bun.write(path, Buffer.from(res.data, "base64"));
            m.files.meshes[`${file === r.name ? "" : file.slice(r.name.length + 1) + ":"}${s.format}`] = path;
          }
        }
        if (variantScenes.length) { await this.host.rpc("load", { scene: b.scene }); this.loaded = r.name; }
      }
    } catch (e) {
      m.errors.push((e as Error).message);
    }
    m.ms = performance.now() - t0;
    return m;
  }
}

function extOf(filename: string | undefined, format: string): string {
  const e = filename ? extname(filename).slice(1) : "";
  return e || format;
}

/** Recipe `export` entries + CLI formats → export_mesh params, one per format (recipe options win). */
export function exportSpecs(recipe: ExportSpec[] | undefined, extra: string[] | undefined): ({ format: string } & Record<string, unknown>)[] {
  const out = new Map<string, { format: string } & Record<string, unknown>>();
  for (const e of recipe ?? []) { const s = typeof e === "string" ? { format: e } : { ...e }; out.set(s.format, s); }
  for (const f of extra ?? []) if (!out.has(f)) out.set(f, { format: f });
  return [...out.values()];
}

/** Builds recipes against a host and writes outputs + manifest. */
export async function buildRecipes(recipes: LoadedRecipe[], host: RecipeHost, opts: BuildOptions): Promise<BuildSummary> {
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  let selected = recipes;
  if (opts.only?.length) {
    const missing = opts.only.filter((n) => !recipes.some((r) => r.name === n));
    if (missing.length) throw new Error(`--only: no recipe named ${missing.join(", ")} (have: ${recipes.map((r) => r.name).join(", ")})`);
    selected = recipes.filter((r) => opts.only!.includes(r.name));
  }
  const builder = new RecipeBuilder(host, recipes);
  const width = Math.max(12, ...selected.map((r) => r.name.length));
  const models: ModelResult[] = [];
  for (const r of selected) {
    const m = await builder.output(r, opts);
    models.push(m);
    opts.log?.(summaryLine(m, width));
    for (const w of m.warnings) opts.log?.(`  WARNING: ${w}`);
    for (const e of m.errors.slice(1)) opts.log?.(`  ERROR: ${e}`);
  }
  // leave the last model the caller asked for loaded (stamp deps or variant meshes may have replaced it)
  const last = selected.at(-1);
  if (last && builder.loaded !== last.name && models.at(-1)?.files.scene) await builder.build(last).catch(() => {});

  let manifest: string | undefined;
  if (opts.manifest !== false) manifest = await writeManifest(outDir, models);
  const ok = models.every((m) => !m.errors.length);
  const nWarn = models.reduce((a, m) => a + m.warnings.length, 0);
  const total = `${models.length} model${models.length === 1 ? "" : "s"}, ${models.filter((m) => m.errors.length).length} failed, ${nWarn} warning${nWarn === 1 ? "" : "s"} → ${outDir}`;
  const text = [...models.flatMap((m) => [summaryLine(m, width), ...m.warnings.map((w) => `  WARNING: ${w}`), ...m.errors.slice(1).map((e) => `  ERROR: ${e}`), ...m.notes.filter((n) => n.startsWith("sheet")).map((n) => `  note: ${n}`)]), total].join("\n");
  return { models, manifest, outDir, ok, clean: ok && nWarn === 0, text };
}

/** Merges this run's models into `<out>/manifest.json` (paths relative to the out dir). */
export async function writeManifest(outDir: string, models: ModelResult[]): Promise<string> {
  const path = join(outDir, "manifest.json");
  let prev: Record<string, unknown> = {};
  if (existsSync(path)) prev = ((await Bun.file(path).json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const rel = (p?: string) => (p ? relative(outDir, p) : undefined);
  for (const m of models) {
    if (m.errors.length) continue;
    prev[m.name] = {
      source: m.source && !relative(outDir, m.source).startsWith("..") ? relative(outDir, m.source) : m.source,
      size: m.size, voxels: m.voxels, bbox: m.bbox, anchors: m.anchors, slots: m.slots,
      files: {
        scene: rel(m.files.scene), sheet: rel(m.files.sheet),
        variants: Object.fromEntries(Object.entries(m.files.variants).map(([k, v]) => [k, rel(v)])),
        meshes: Object.fromEntries(Object.entries(m.files.meshes).map(([k, v]) => [k, rel(v)])),
      },
      warnings: m.warnings,
    };
  }
  await Bun.write(path, JSON.stringify(prev, null, 1));
  return path;
}
