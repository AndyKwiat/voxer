# recipes — models as code

A **recipe** is a model written as data or code: grid size, material slots, drawing ops (or a function
that produces them), anchors, color variants and mesh outputs. The builder replays it through Voxer
(the same `Editor` the app uses) and writes scene files, snapshot sheets, variants, meshes and a manifest.

```sh
bun run recipe recipes/examples                      # = bun scripts/build.ts recipes/examples
bun run recipe recipes/examples/house.js --figure --export glb --out out/recipes
bun run recipe my/recipes --only house,tree --strict --no-sheet
```

From an agent: the MCP tool `build_recipe {path, out_dir?, only?, export?, figure?, sheet?, show_sheet?}` does the
same against the MCP server's page and leaves the last model loaded (keep sculpting, `snapshot`, `save_scene`).

## File format

A recipe file is a `.js` / `.mjs` / `.ts` module or a `.json` file. It exports:

- `export default { …recipe }` — one recipe; its name defaults to the file's base name;
- `export default [recipe, recipe]` — several (each needs a `name`);
- `export default { house: {…}, tree: {…} }` — a record; keys are the default names;
- no default export: every named export that is a recipe (or an array of them). Exports that aren't
  recipes (helper functions, color tables) are ignored, so a directory can hold helper modules.

`.json` takes the same shapes (minus `build`). `examples/house.json` at the repo root is already a valid recipe.

```js
export default {
  name: "house",              // [A-Za-z0-9][A-Za-z0-9_.-]*; output files are <name>.json etc.
  size: 40,                   // grid size, default 32, max 256
  description: "…",           // optional
  palette: ["#…"],            // optional starting palette (default: Voxer's 32 defaults; always reset per recipe)
  slots: {                    // material slots, defined in order before any op runs (define_slot)
    roof: { base: "#3a9ab0", shades: { dark: 0.74, light: 1.22 } },   // shade = factor or "#hex"
    trim: "#c04030",                                                   // just a base
  },
  ops: [ { op: "roof", min: [4, 9], max: [35, 31], y: 13, color: "slot:roof", ramp: { dark: "slot:roof.dark" } } ],
  // …or instead of ops:  build(ctx) { … }   (see below)
  anchors: { door: { x: 20, y: 0, z: 31, dir: "+z", note: "…" } },
  variants: { gold: { roof: "#e8b830" } },   // → <name>@gold.json (make_variant: recolors slots only)
  export: ["glb", { format: "obj", scale: 0.1 }],   // meshes: format glb|obj|json + export_mesh options
  lint: { speckSize: 3 },     // lint options (core/Lint.ts), or false to skip lint
  sheet: { views: ["front", "iso"], tile: 360, figure: true },   // or false for no sheet
  meta: { … },                // free-form; not used by the builder
};
```

Unknown keys are errors (typos don't pass silently), and every problem in a recipe is reported at once.
Ops are the normal `draw` ops (`src/core/Commands.ts`, parts in `src/core/Parts.ts`); the builder checks
op names up front and core validates the rest.

### Slot colors in ops: `"slot:<slot>"` / `"slot:<slot>.<shade>"`

Any string in an op (any depth: `color`, `colors: [...]`, `ramp`, `legend`, voxel lists…) and any object
key (e.g. stamp `reshade` / `recolor` maps) of that form is replaced by the slot's palette hex before the
ops run. Slots are defined first, so the hex is the one `define_slot` actually put in the palette (it can
be nudged by ±1 to stay unique) and painting with it hits the slot's entry — which is what makes
`recolor_slot` and `variants` recolor those voxels. Unknown slots/shades fail with the op and path,
e.g. `op 14 (roof).ramp.dark: slot "roof" has no shade "dark"`.

Parts derive shades from their base color (roof: ×0.74 dark, ×1.22 light, ×1.42 cap, ×0.45 ridge,
×0.86 side; walls: ×0.93, ×1.04, ×0.72 top row; pillar/post caps ×0.74). Give a slot the same factors
and pass the shades explicitly (`ramp: { dark: "slot:roof.dark", … }`, `capital: "slot:pillar.cap"`), or
rely on the derived colors matching — `recipes/examples/house.js` does both.

### `build(ctx)` — recipes as code

```js
export default {
  name: "tree", size: 24,
  slots: { leaf: { base: "#3aa848", shades: { dark: 0.8 } } },
  build(ctx) {
    const rnd = ctx.rng(7);                         // seeded: same model every build
    ctx.box([12, 0, 12], [12, 7, 12], "#7a5232");   // = ctx.add({ op: "box", … })
    for (let i = 0; i < 40; i++) ctx.set(12 + rnd() * 6 - 3, 8 + rnd() * 4, 12 + rnd() * 6 - 3, ctx.slots.leaf.dark);
    ctx.anchor("top", { x: 12, y: 12, z: 12, dir: "+y" });
    return [{ op: "mirror", axis: "x", pivot: 24 }];  // optional: returned / yielded ops are appended
  },
};
```

`ctx`: `name`, `size`, `slots` (`ctx.slots.leaf.dark` → hex), `slot(name, shade?)`, `rng(seed)` (mulberry32,
same as the waldo recipes), `shade(hex, f)`, `hash3(x, y, z, seed?)`, `add(...ops)`, `set(x, y, z, color | null)`
(coordinates rounded; consecutive calls collect into one `set` op, kept in order with `add`), `box(min, max, color)`,
`anchor(name, {x, y, z, dir?, note?})`. `build` may be async, return an array / iterable of ops, be a generator
(`*build(ctx) { yield op }`), or return `{ ops, anchors }`. Big `set` ops are split into several `run` batches.

Porting a sketchpad-style recipe (e.g. waldo's `G` with `toOps()`): `{ size: g.size, build: () => g.toOps() }`
— see "From the old workflow" below.

### Composition: stamping other recipes

```js
{ op: "stamp", recipe: "house", at: [30, 1, 3], rot: 1, reshade: { "slot:roof": "#c04030" }, anchorPrefix: "west_" }
```

`recipe` is a recipe name (from the files being built, else a sibling `<name>.js/.ts/.mjs/.json` next to this
recipe) or a file path relative to this recipe (`"./tree.ts"`, `"./houses.js#home2"` for one of several). The
builder builds that recipe first (once per run, cycles are reported) and passes its scene to `stamp`; all
the usual stamp options apply (`at`, `rot`, `mirror`, `recolor`, `reshade`, `crop`, `anchor`). With
`anchorPrefix`, the stamped recipe's anchors are carried along — moved and turned exactly like its cells —
as `<prefix><name>` (the recipe's own `anchors` win on a clash). Stamping copies colors, not slots: define
the same slot in the composite (as `examples/courtyard.js` does for `roof`) and the stamped colors land on
its entries, so the composite stays recolorable. `stamp {scene: "./thing.json"}` (a path) pastes a scene file.

## What the builder does

Per recipe: `new_scene {size, palette}` → `define_slot` per slot → expand ops (`build(ctx)`, slot refs) →
build stamped recipes → `run` (batched: ≤400 ops / ≤50k set voxels per call) → `set_anchor` → `lint` →
`serialize`. Then it writes, under the out dir:

| File | What |
|---|---|
| `<name>.json` | the scene (v2 when it has slots/anchors; `load_scene {path}` reads it) |
| `<name>@<variant>.json` | one per `variants` entry |
| `<name>.<glb\|obj\|json>`, `<name>@<variant>.<ext>` | meshes, from the recipe's `export` plus `--export` |
| `sheets/<name>.png` | snapshot sheet (default views front, iso, iso_left, top; tile 300; anchors drawn). Best-effort: a stalled render is retried smaller (`mcp/snapshot.ts`), a failure is a note, not an error |
| `manifest.json` | `name → { source, size, voxels, bbox, anchors, slots, files, warnings }`, merged into an existing manifest so `--only` runs keep the other entries |

and prints one line per model, plus its warnings (from the write report — clipping, erasing an earlier op's
cells — and from lint — specks, floating pieces, boundary contact, near-duplicate colors):

```
house           4420 vox  bbox 3,0,8..36,24,32             679 ms  ok
tree_pine        961 vox  bbox 5,0,5..19,21,19             396 ms  2 warn
  WARNING: lint: 1 speck (< 4 voxels): 1 at 12,21,12
```

A recipe that throws (bad op, unknown slot, stamp cycle) is reported and the others still build. Exit code:
1 if any recipe failed, 1 on any warning with `--strict`, else 0.

## CLI

```
bun scripts/build.ts <recipe files or dirs…> [--out dir] [--only a,b] [--sheet|--no-sheet] [--figure[=N]]
                     [--views front,iso,…] [--tile px] [--export glb,obj,json] [--strict] [--quiet]
```

- **Out dir**: `--out`, default `./out/recipes` relative to the current directory (gitignored in this repo).
  The MCP tool's `out_dir` defaults to `out/recipes` under the MCP server's working directory (the Voxer checkout).
- Directories are searched recursively for `.js/.mjs/.ts/.json`, skipping `out/`, `node_modules/`, `_*`, `.*` and READMEs.
- With sheets (default) it runs scratch mode via `scripts/lib/headless.ts`: a private in-memory app server and
  one headless Chrome shared by all recipes — it never touches `models/` or a Voxer tab you have open.
  `--no-sheet` doesn't start a browser at all: it builds in-process on a core `Editor` (same results, ~10× faster).
- `VOXER_SNAPSHOT_TIMEOUT_MS` sets the per-attempt sheet timeout (default 30 s).
- JS/TS recipe files are re-imported on every build (edits are picked up, also in a long-running MCP server);
  modules they import are cached by Bun until the process restarts.

## From the old workflow

A game project kept ~30 models as functions painting a sparse grid `G` and a custom driver
(`build-models.ts` + `voxer.ts`) to replay them through a private Voxer. With recipes that driver is one file:

```js
// waldo.js, next to the old recipes/index.js
import { RECIPES } from "./index.js";
export default Object.fromEntries(Object.entries(RECIPES).map(([name, make]) => {
  const g = make();
  return [name, { size: g.size, build: () => g.toOps(), lint: { palette: false } }];
}));
```

`bun run recipe path/to/waldo.js --out models --figure` builds all 32 models with sheets in ~16 s, and lint
points at real problems the old driver never reported (e.g. `lantern_post` clipped at the top of its 12³ grid
and its lanterns left floating). New models can then move to slots + parts ops one at a time.

## Examples (`recipes/examples/`)

| File | Shows |
|---|---|
| `house.js` | `examples/house.json` as a recipe: roof / wall / pillar slots referenced as `"slot:…"`, `door` + `roof_top` anchors, a `gold` roof variant |
| `tree.ts` | `build(ctx)` with a seeded RNG, `ctx.set` sparse painting, slot colors through `ctx.slots`, an anchor from code, an `autumn` variant |
| `courtyard.js` | composition: two stamped `house` recipes (one turned, roof reshaded red) and a stamped `./tree.ts`, carried anchors via `anchorPrefix`, a shared `roof` slot |

All three build with no warnings (`--strict` passes); `test/Recipe.test.ts` builds them in-process.
