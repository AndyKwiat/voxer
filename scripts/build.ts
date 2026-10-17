/**
 * Builds recipe files into Voxer scenes, snapshot sheets, variants and meshes (see recipes/README.md).
 *
 *   bun scripts/build.ts recipes/examples                       # every recipe in the directory
 *   bun run recipe recipes/examples/house.js --figure --export glb
 *   bun scripts/build.ts a.js b.json --out models/game --only house,tree --views front,iso --tile 360
 *
 * Options:
 *   --out <dir>        output directory (default ./out/recipes, relative to the current directory)
 *   --only <a,b>       build just these recipe names (stamped recipes are still built as needed)
 *   --sheet/--no-sheet snapshot sheets (default on). --no-sheet runs in-process, no browser at all
 *   --figure[=N]       scale person (N cells tall, default 8) on the sheets
 *   --views <a,b>      sheet views (default front,iso,iso_left,top)   --tile <px>  tile size (default 300)
 *   --export <glb,obj,json>  extra mesh formats for every recipe
 *   --strict           exit 1 on warnings too (errors always exit 1)
 *   --quiet            only the summary lines
 *
 * Uses scratch mode (`scripts/lib/headless.ts`): its own in-memory app server + one headless Chrome for
 * all recipes, so it never touches models/ or a Voxer tab you have open.
 */
import { resolve } from "node:path";
import { isViewName, VIEW_NAMES } from "../src/render/Views";
import { buildRecipes, loadRecipes } from "./lib/recipe-build";
import { MESH_FORMATS } from "../src/core/MeshExport";
import { coreHost, pageHost, type RecipeHost } from "./lib/recipe-host";

const USAGE = "usage: bun scripts/build.ts <recipe files or dirs…> [--out dir] [--only a,b] [--sheet|--no-sheet] [--figure[=N]] [--views a,b] [--tile px] [--export glb,obj] [--strict] [--quiet]";

function parseArgs(argv: string[]) {
  const o = { paths: [] as string[], out: "out/recipes", only: undefined as string[] | undefined, sheet: true, figure: undefined as boolean | number | undefined, views: undefined as string[] | undefined, tile: undefined as number | undefined, export: undefined as string[] | undefined, strict: false, quiet: false };
  const list = (v: string | undefined, k: string) => { if (!v || v.startsWith("--")) throw new Error(`${k} needs a value`); return v.split(",").map((s) => s.trim()).filter(Boolean); };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const [k, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
    const val = () => inline ?? argv[++i];
    switch (k) {
      case "--out": o.out = list(val(), k)[0]!; break;
      case "--only": o.only = list(val(), k); break;
      case "--sheet": o.sheet = true; break;
      case "--no-sheet": o.sheet = false; break;
      case "--figure": o.figure = inline ? Number(inline) : true; if (o.figure !== true && !(o.figure! > 0)) throw new Error("--figure=N needs a positive height"); break;
      case "--views": o.views = list(val(), k); for (const v of o.views) if (!isViewName(v)) throw new Error(`unknown view ${v} (one of ${VIEW_NAMES.join(", ")})`); break;
      case "--tile": o.tile = Number(val()); if (!(o.tile > 0)) throw new Error("--tile needs a number"); break;
      case "--export": o.export = list(val(), k); for (const f of o.export) if (!(MESH_FORMATS as readonly string[]).includes(f)) throw new Error(`--export: unknown format ${f} (${MESH_FORMATS.join(", ")})`); break;
      case "--strict": o.strict = true; break;
      case "--quiet": o.quiet = true; break;
      case "-h": case "--help": console.log(USAGE); process.exit(0);
      default:
        if (a.startsWith("-")) throw new Error(`unknown option ${a}\n${USAGE}`);
        o.paths.push(a);
    }
  }
  if (!o.paths.length) throw new Error(USAGE);
  return o;
}

let args: ReturnType<typeof parseArgs>;
try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error((e as Error).message); process.exit(2); }

const t0 = performance.now();
let recipes;
try { recipes = await loadRecipes(args.paths); } catch (e) { console.error(`ERROR: ${(e as Error).message}`); process.exit(1); }
if (!recipes.length) { console.error("no recipes found in " + args.paths.join(", ")); process.exit(1); }

let host: RecipeHost, close = () => {};
if (args.sheet) {
  const { startVoxer } = await import("./lib/headless");
  const vx = await startVoxer({ scratch: true });
  close = vx.close;
  host = pageHost((m, p, t) => vx.rpc(m, p, { timeoutMs: t }), { log: (s) => console.error(`  ${s}`) });
} else host = coreHost();

let code = 0;
try {
  const log = (line: string) => { if (!args.quiet || !line.startsWith("  ")) console.log(line); };
  const r = await buildRecipes(recipes, host, {
    outDir: resolve(args.out), only: args.only, sheet: args.sheet, figure: args.figure, views: args.views, tile: args.tile, export: args.export,
    snapshotTimeoutMs: process.env.VOXER_SNAPSHOT_TIMEOUT_MS ? Number(process.env.VOXER_SNAPSHOT_TIMEOUT_MS) : undefined, log,
  });
  if (!args.quiet) for (const m of r.models) for (const n of m.notes) if (n.startsWith("sheet")) console.log(`  note: ${m.name}: ${n}`);
  const nWarn = r.models.reduce((a, m) => a + m.warnings.length, 0), nFail = r.models.filter((m) => m.errors.length).length;
  console.log(`${r.models.length} model(s), ${nFail} failed, ${nWarn} warning(s), ${Math.round(performance.now() - t0)} ms → ${r.outDir}${r.manifest ? " (manifest.json)" : ""}`);
  code = !r.ok ? 1 : args.strict && !r.clean ? 1 : 0;
  if (code && args.strict && r.ok) console.log("--strict: failing on warnings");
} catch (e) {
  console.error(`ERROR: ${(e as Error).message}`);
  code = 1;
} finally {
  close();
}
process.exit(code);
