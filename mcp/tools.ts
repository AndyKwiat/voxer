/** MCP tool definitions (JSON Schema) for the Voxer server. Kept separate from transport/plumbing. */

const vec3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z] cell coordinates" };
const color = { type: ["string", "integer"], description: 'Hex "#rrggbb" (auto-added to the palette) or palette index' };
const axis = { type: "string", enum: ["x", "y", "z"] };
const shape = { color, erase: { type: "boolean", description: "Carve (set empty) instead of filling" } };

// ---- architecture parts library (src/core/Parts.ts) ----
const vec2 = { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 };
const face = { type: "string", enum: ["+z", "-z", "+x", "-x"], description: 'Outward normal of the wall face (default "+z", the front). Along the face = +x on z faces, +z on x faces' };
const vec3s = { oneOf: [vec3, { type: "array", items: vec3 }], description: "[x, y, z] or a list of them" };
const pattern = {
  pattern: { type: "string", enum: ["brick", "checker", "stripes", "noise"], description: "Fill pattern instead of one color" },
  colors: { type: "array", items: color, description: "Pattern colors. brick: [brick, mortar, light]; checker/stripes: cycled; noise: [base, speckles...]. Default: shades of `color`" },
  seed: { type: "integer", description: "Deterministic seed for noise/brick/mottle (default 0)" },
  density: { type: "number", description: "noise speckle fraction (0.15) / brick light-brick fraction (0.12)" },
  scale: { type: "integer", description: "checker/stripes cell size (default 1)" },
};
const PART_SCHEMAS = [
  { properties: {
      op: { const: "roof" }, min: { ...vec2, description: "[x, z] footprint corner (e.g. the walls' min x,z)" }, max: { ...vec2, description: "[x, z] opposite corner" },
      y: { type: "integer", description: "Base layer y (usually wall top + 1)" },
      style: { type: "string", enum: ["hip", "gable"], description: "Default hip" },
      eave: { oneOf: [{ type: "integer" }, vec2], description: "Overhang beyond min/max on each side, number or [x, z] (default 2)" },
      axis: { type: "string", enum: ["x", "z"], description: "Ridge direction (default: the longer side)" },
      steps: { type: "array", items: { type: "integer" }, description: "Per-layer inset across the ridge = slope profile, e.g. [2,2,1] (default; then 1s) is the concave Chinese curve, [1,1,1] straight" },
      hipSteps: { type: "array", items: { type: "integer" }, description: "Per-layer inset at the hip ends (default [2,1,1]); ignored for gable" },
      maxLayers: { type: "integer", description: "Stop after N layers (skirt / ring roof between storeys; use with ridge:false)" },
      ridge: { type: "boolean", description: "Ridge with curled ends on top (default true). Ridge y = y + number of layers" },
      corners: { type: "string", enum: ["upturned", "flat"], description: "Flared eave corners (default upturned)" },
      pearl: { type: ["boolean", "string", "integer"], description: "Finial on the ridge: true (gold) or a color" },
      color: { ...color, description: "Base tile color; dark/light/cap/ridge/side shades are derived (default #3a9ab0)" },
      ramp: { type: "object", properties: { base: color, dark: color, light: color, cap: color, ridge: color, side: color }, description: "Explicit shade overrides" },
    }, required: ["op", "min", "max", "y"],
    description: "Stacked-layer tiled roof (hip or gable) with tile channels, hip ridges, eave caps, upturned corners, ridge with end curls. Layers shrink by steps until < 3 wide." },
  { properties: {
      op: { const: "walls" }, min: vec3, max: vec3, color: { ...color, description: "Plaster (default #f6e8c8)" }, ...pattern,
      skirt: { oneOf: [{ type: "boolean" }, { type: "integer" }, { type: "object", properties: { rows: { type: "integer" }, color, dark: color } }], description: "Stone skirt rows at the bottom: true (=2 rows), N rows, or {rows,color,dark}" },
      top: { type: ["boolean", "string", "integer"], description: "Shadow row under the eaves (default true = color×0.72); false or a color" },
      posts: { type: ["boolean", "string", "integer"], description: "Corner posts: true (red #d0402e) or a color; top cell darker" },
      postTop: color,
      mottle: { type: "number", description: "Fraction of plaster cells speckled darker/lighter (default 0.14; 0 = flat). Deterministic via seed" },
      floor: { type: ["boolean", "string", "integer"], description: "Fill the interior at min.y: true (stone) or a color" },
    }, required: ["op", "min", "max"], description: "Room shell (4 walls, 1 thick) from min to max inclusive; interior left empty." },
  { properties: {
      op: { const: "window" }, at: { ...vec3, description: "Bottom-left cell of the opening ON the wall surface (min along the face)" }, face,
      size: { ...vec2, description: "[width, height] of the opening (default [4,5])" },
      style: { type: "string", enum: ["lattice", "slats", "plain", "round", "open"], description: "Default lattice" },
      frame: color, sill: { type: ["string", "integer", "null"] }, fill: { ...color, description: "Paper (default #f6e6b8)" }, lattice: color,
    }, required: ["op", "at"], description: "Window: opening carved in the wall, pane recessed 1 cell, wooden frame around, sill sticking out below." },
  { properties: {
      op: { const: "door" }, at: { ...vec3, description: "Bottom-left cell of the opening on the wall surface" }, face,
      size: { ...vec2, description: "[width, height] (default [4,9])" },
      color: { ...color, description: "Leaves (default #c8342a)" }, seam: color, studs: { type: ["string", "integer", "null"] },
      frame: { type: ["string", "integer", "null"], description: "Side posts (default red, gold bands)" }, lintel: { type: ["string", "integer", "null"] },
      plaque: { type: ["boolean", "string", "integer"], description: "Name plaque above the lintel (true or a color)" }, plaqueText: color,
    }, required: ["op", "at"], description: "Recessed double door with studs, framed by posts + lintel, optional plaque." },
  { properties: { op: { const: "pillar" }, at: vec3s, height: { type: "integer", description: "Total cells incl. base and capital (default 8)" }, size: { type: "integer", description: "Square cross-section (default 1)" },
      color: { ...color, description: "Default red #d0402e" }, base: { type: ["string", "integer", "boolean"], description: "Plinth color (default stone) or false" }, capital: { type: ["string", "integer", "boolean"], description: "Top cell (default color×0.74) or false" } },
    required: ["op", "at"], description: "Column(s) rising from `at` (bottom cell)." },
  { properties: { op: { const: "beam" }, from: vec3, to: vec3, color: { ...color, description: "Default blue #2f6fa8" }, dot: { type: ["string", "integer", "null"], description: "Dot color (default gold; null = none)" },
      every: { type: "integer", description: "Dot every N cells, aligned to world coords (default 3)" }, offset: { type: "integer" } },
    required: ["op", "from", "to"], description: "Painted beam / band along a line with a dot pattern." },
  { properties: { op: { const: "railing" }, from: vec3, to: vec3, height: { type: "integer", description: "Default 2: posts below, rail on top" }, color, post: color, every: { type: "integer", description: "Post every N cells (default 2)" } },
    required: ["op", "from", "to"], description: "Balcony railing: rail at from.y+height-1, posts every N cells below it." },
  { properties: { op: { const: "stairs" }, at: { ...vec3, description: "Front-left cell of the lowest step (min along the face)" }, face: { ...face, description: "Direction the stairs face (they climb away from it)" },
      steps: { type: "integer", description: "Default 3" }, width: { type: "integer", description: "Default 3" }, rise: { type: "integer" }, run: { type: "integer", description: "Tread depth (default 1)" },
      color, edge: { ...color, description: "Tread nosing color" }, solid: { type: "boolean", description: "Fill under the steps (default true)" } },
    required: ["op", "at"], description: "Staircase." },
  { properties: { op: { const: "arch" }, min: vec3, max: vec3, axis: { type: "string", enum: ["x", "z"], description: "Passage direction (default z)" }, color: { ...color, description: "Fill instead of carving" } },
    required: ["op", "min", "max"], description: "Carves an arched opening/tunnel: straight sides with a round crown filling the box's top half-width." },
  { properties: { op: { const: "crenels" }, min: vec3, max: vec3, color, every: { type: "integer", description: "Period (default 2)" }, width: { type: "integer", description: "Merlon width (default 1)" },
      sides: { type: "array", items: face } },
    required: ["op", "min", "max"], description: "Battlements around the rectangle min..max (x,z); y range = merlon height. Put min.y = wall top + 1." },
  { properties: { op: { const: "lantern" }, at: { ...vec3s, description: "Hook cell; the lantern hangs below it" }, size: { type: "integer", description: "Body cells (default 2)" }, color, cap: color, tassel: color },
    required: ["op", "at"], description: "Hanging lantern(s)." },
  { properties: { op: { const: "stamp" }, scene: { type: ["object", "string"], description: "Saved scene name (models/<name>.json) or SceneData {version,size,palette,data}" },
      at: { ...vec3, description: "Where the min corner lands (default [0,0,0])" }, rot: { type: "integer", enum: [0, 1, 2, 3], description: "Quarter turns about Y; 1 turns the front (+z) to face +x" },
      mirror: { type: "string", enum: ["x", "z"], description: "Flip before rotating" }, recolor: { type: "object", additionalProperties: { type: ["string", "null"] }, description: '{"#from": "#to" | null (drop)}, exact colors' },
      reshade: { type: "object", additionalProperties: { type: "string" }, description: '{"#base": "#newBase"}: remaps a base color AND every shade the parts library derives from it (e.g. a whole roof ramp)' },
      anchor: { type: "string", enum: ["bbox", "origin"], description: "bbox (default): the scene's occupied bounding box is placed at `at`; origin: its whole grid" },
      crop: { type: "object", properties: { min: vec3, max: vec3 }, description: "Only source cells inside this box" } },
    required: ["op", "scene"], description: "Copy another scene's voxels into this one (colors merge into the palette)." },
];

const OP_SCHEMAS = [
  { properties: { op: { const: "box" }, min: vec3, max: vec3, ...shape, hollow: { type: "boolean" }, ...pattern, axis: { ...axis, description: "pattern stripes: axis the bands advance along (default y)" } }, required: ["op", "min", "max"],
    description: "Axis-aligned box, inclusive bounds. With pattern (brick/checker/stripes/noise) + colors (or color for an auto ramp) it is filled with that pattern." },
  { properties: { op: { const: "ellipsoid" }, center: vec3, radius: { oneOf: [{ type: "number" }, vec3], description: "Number (sphere) or [rx, ry, rz]; diameter = 2r+1 cells" }, ...shape, hollow: { type: "boolean" } },
    required: ["op", "center", "radius"], description: "Sphere / ellipsoid centered on a cell." },
  { properties: { op: { const: "cylinder" }, base: vec3, radius: { type: "number" }, height: { type: "integer", description: "Cells along axis from base (negative = downward)" }, axis, ...shape, hollow: { type: "boolean" } },
    required: ["op", "base", "radius", "height"], description: "Cylinder; base = center of the first slice; axis defaults to y." },
  { properties: { op: { const: "line" }, from: vec3, to: vec3, radius: { type: "number", description: "Thickness radius (0 = 1 voxel)" }, ...shape }, required: ["op", "from", "to"],
    description: "Straight voxel line (both endpoints included)." },
  { properties: {
      op: { const: "layer" }, axis, index: { type: "integer", description: "Slice coordinate on that axis" },
      rows: { type: "array", items: { type: "string" }, description: "One string per row, top row first; one char per cell. '.' or ' ' = leave unchanged" },
      legend: { type: "object", additionalProperties: { type: ["string", "integer", "null"] }, description: 'char → color; null erases. e.g. {"r":"#cc2222","w":"#ffffff","x":null}' },
      offset: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2, description: "[a, b] — see layout" },
      clear: { type: "boolean", description: "'.'/' ' erase instead of skipping" },
    }, required: ["op", "axis", "index", "rows", "legend"],
    description: "ASCII-art slice, laid out exactly as the matching snapshot view shows it. axis y (TOP view, slice y=index): char col → x = a+col, row r → z = b+r (row 0 = back). axis z (FRONT view, slice z=index): x = a+col, last row at y = b, rows go up. axis x (LEFT view, slice x=index): z = a+col, last row at y = b." },
  { properties: { op: { const: "set" }, voxels: { type: "array", items: { type: "array", minItems: 4, maxItems: 4 }, description: "[[x, y, z, color|null], ...]" } }, required: ["op", "voxels"],
    description: "Individual voxels (null color erases)." },
  { properties: { op: { const: "mirror" }, axis, pivot: { type: "integer", description: "Cell c maps to pivot-c. Default size-1 (grid center). Model centered on cell 16 → 32; between 15|16 → 31" },
      source: { type: "string", enum: ["lower", "upper"], description: "Which half is copied onto the other (default lower)" } },
    required: ["op", "axis"], description: "Copy one half onto the other for symmetry." },
  { properties: { op: { const: "translate" }, offset: vec3, min: vec3, max: vec3, copy: { type: "boolean", description: "Duplicate instead of move" } },
    required: ["op", "offset"], description: "Move (or copy) everything, or only the inclusive box min..max." },
  { properties: { op: { const: "replace_color" }, from: color, to: { type: ["string", "integer", "null"] }, min: vec3, max: vec3 }, required: ["op", "from", "to"],
    description: "Recolor voxels of one color (optionally inside a box); to=null erases them." },
  { properties: { op: { const: "clear" } }, required: ["op"], description: "Erase everything." },
  ...PART_SCHEMAS,
].map((s) => ({ type: "object", ...s }));

const views = { type: "array", items: { type: "string", enum: ["front", "back", "left", "right", "top", "bottom", "iso", "iso_left", "iso_back"] } };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

export const TOOLS: ToolDef[] = [
  {
    name: "scene_info",
    description: "Grid size, voxel count, bounding box, colors in use, palette, undo state, connected viewers.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "new_scene",
    description: "Start an empty scene (clears undo history). Optional size (1..256, default keeps current; 32 default) and replacement palette.",
    inputSchema: { type: "object", properties: { size: { type: "integer", minimum: 1, maximum: 256 }, palette: { type: "array", items: { type: "string" } } } },
  },
  {
    name: "draw",
    description:
      "Apply a batch of drawing ops as ONE undo step (atomic: any bad op aborts the batch). Later ops see earlier ones. " +
      "Coordinates are integer cells, Y up, front faces +Z; out-of-grid cells are clipped. Prefer few large batches. " +
      "Ops: box, ellipsoid, cylinder, line, layer (ASCII slices — the best way to paint detail), set, mirror, translate, replace_color, clear. " +
      "Parts library (buildings in ~10 ops; sensible defaults, colors auto-shaded): roof (hip/gable, Chinese curve), walls (room shell, skirt, posts, mottle), " +
      "window, door, pillar, beam, railing, stairs, arch (carve), crenels, lantern, stamp (paste a saved scene, rotate/mirror/recolor); box also takes pattern: brick|checker|stripes|noise.",
    inputSchema: { type: "object", properties: { ops: { type: "array", items: { oneOf: OP_SCHEMAS } } }, required: ["ops"] },
  },
  {
    name: "run_script",
    description:
      "Run JavaScript for procedural geometry (loops, math). In scope: S (grid size), get(x,y,z) → palette index or -1, " +
      "set(x,y,z,color|null), op({op:'box',...}) (any draw op), Math. All writes = one undo step; `return` a value to get it back.",
    inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
  },
  {
    name: "get_layer",
    description: "ASCII dump of one slice in the same layout `layer` reads (edit it and draw it back). Optional crop in layer coords {a0,a1,b0,b1}.",
    inputSchema: {
      type: "object",
      properties: { axis, index: { type: "integer" }, crop: { type: "object", properties: { a0: { type: "integer" }, a1: { type: "integer" }, b0: { type: "integer" }, b1: { type: "integer" } } } },
      required: ["axis", "index"],
    },
  },
  {
    name: "snapshot",
    description:
      "Render a labeled contact sheet (one PNG). If rendering is slow it is retried with smaller tiles / fewer views and the result says what was degraded. Axis views are orthographic with a cell grid and rulers (numbers = cell coordinates); " +
      "iso views are perspective. Default views: front, left, top, iso. Set reference=true to add the reference image as a tile for comparison.",
    inputSchema: {
      type: "object",
      properties: {
        views,
        tile: { type: "integer", minimum: 96, maximum: 1024, description: "Pixels per tile (default 360)" },
        frame: { type: "string", enum: ["content", "grid"], description: "Zoom to the model (default) or show the whole grid" },
        reference: { type: "boolean" },
        shading: { type: "string", enum: ["flat", "lit"], description: "Axis views: flat (default) = exact palette colors; lit = scene lighting" },
        columns: { type: "integer", minimum: 1 },
        anchors: { type: "boolean", description: "Draw anchors (cell outline + name + dir arrow; dot in iso views). Default: on when the scene has any" },
        figure: { type: "boolean", description: "Draw a blocky person (cyan legs, magenta torso, yellow head) beside the model, standing on y=0, to judge door heights and proportions. Snapshot-only, never part of the scene. Default false" },
        figure_height: { type: "number", minimum: 1, maximum: 256, description: "Scale figure height in cells (default 8; implies figure=true)" },
      },
    },
  },
  {
    name: "set_view",
    description: "Point the live viewer's camera at a named view (for a human watching in the browser).",
    inputSchema: { type: "object", properties: { view: { type: "string", enum: [...views.items.enum, "reset"] } }, required: ["view"] },
  },
  {
    name: "undo",
    description: "Undo the last N steps (each draw / run_script / mouse stroke is one step).",
    inputSchema: { type: "object", properties: { steps: { type: "integer", minimum: 1, default: 1 } } },
  },
  {
    name: "redo",
    description: "Redo N undone steps.",
    inputSchema: { type: "object", properties: { steps: { type: "integer", minimum: 1, default: 1 } } },
  },
  {
    name: "set_palette",
    description: "Replace palette colors by index. Voxels keep their indices, so this recolors the model. (draw ops already add hex colors automatically.)",
    inputSchema: { type: "object", properties: { colors: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 255 } }, required: ["colors"] },
  },
  {
    name: "set_reference",
    description: "Set the reference image from a local file path (png/jpg/webp/gif) or http(s) URL. Shown in the app sidebar and usable by snapshot/sample_reference.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, url: { type: "string" } } },
  },
  {
    name: "get_reference",
    description: "Return the current reference image (pasted/dropped into the app by the user, or set with set_reference).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sample_reference",
    description:
      "Downsample the reference image to a cols×rows character grid with a k-means palette: returns {grid: string[], legend: {char: hex}}, " +
      "ready to paste into a `layer` op (e.g. extrude a front-view silhouette). Background is auto-keyed from the corners.",
    inputSchema: {
      type: "object",
      properties: {
        cols: { type: "integer", minimum: 1, maximum: 256, description: "Default 32" },
        rows: { type: "integer", minimum: 1, maximum: 256, description: "Default keeps aspect ratio" },
        crop: { type: "object", description: "Fractions of the image (0..1)", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] },
        maxColors: { type: "integer", minimum: 1, maximum: 62, description: "Default 8" },
        background: { type: "string", description: '"auto" (default), "none", or a hex color to key out' },
        tolerance: { type: "number", description: "Background match distance 0..441 (default 40)" },
      },
    },
  },
  {
    name: "save_scene",
    description: "Save the current scene as models/<name>.json, or to an absolute file `path` (e.g. into your own project; parent dirs are created). Give name or path. In scratch mode names stay in memory, so use path to keep the file.",
    inputSchema: { type: "object", properties: { name: { type: "string", pattern: "^[A-Za-z0-9][\\w.-]{0,63}$" }, path: { type: "string", description: "Absolute path of the .json file to write" } } },
  },
  {
    name: "load_scene",
    description: "Load models/<name>.json, or a scene JSON file at an absolute `path` (replaces the current scene, clears undo). Give name or path.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, path: { type: "string", description: "Absolute path of a Voxer scene .json file" } } },
  },
  {
    name: "list_scenes",
    description: "List saved scene names.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "open_viewer",
    description: "Open the app in the user's default browser so they can watch live; it takes over from the headless page with the same scene.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "export_mesh",
    description:
      "Export the scene as a mesh: greedy-merged exposed faces with per-vertex ambient occlusion baked into vertex colors. " +
      "glb = glTF 2.0 binary (COLOR_0 linear), obj = OBJ with `v x y z r g b` sRGB vertex colors, json = base64 typed arrays. " +
      "With `path` the file is written there (absolute, or relative to the MCP server's cwd) and only stats are returned; otherwise the file comes back base64.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["glb", "obj", "json"], description: "Default glb" },
        path: { type: "string", description: "File to write, e.g. /abs/dir/model.glb" },
        pivot: { type: "string", enum: ["corner", "base", "center"], description: "Origin: base (default) = grid centre x/z at y=0; corner = Voxer cell coords; center = grid centre" },
        scale: { type: "number", exclusiveMinimum: 0, description: "World units per voxel (default 1)" },
        ao: { type: "boolean", description: "Bake ambient occlusion + darker bottom faces (default true)" },
        merge: { type: "boolean", description: "Greedy-merge coplanar faces with equal color and AO (default true; visuals identical)" },
        remap: { type: "object", additionalProperties: { type: "string" }, description: 'Color substitutions {"#from": "#to"}' },
        colorSpace: { type: "string", enum: ["linear", "srgb"], description: "json only: vertex color space (default linear)" },
        name: { type: "string", description: "Mesh/node name in the file (default voxer)" },
      },
    },
  },
  {
    name: "define_slot",
    description:
      "Define a named material slot (e.g. roof, wall, pillar, cloth) as a shade ramp so the model can be recolored later (recolor_slot / make_variant). " +
      "Form 1 {name, base, shades?}: adds base + each shade (factor × base per RGB channel, e.g. {dark: 0.74, light: 1.22}, or an explicit hex) to the palette " +
      "and returns {colors: {base: hex, dark: hex, …}} — paint with exactly those hexes (they are kept unique, so they may differ from the request by ±1). " +
      "Redefining a slot reuses its palette entries by shade name. Form 2 {name, colors: [hex|index, …], names?}: adopts existing palette colors (first = base; factors are fitted).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_-]{0,31}$" },
        base: { type: "string", description: "#rrggbb" },
        shades: { type: "object", additionalProperties: { type: ["number", "string"] }, description: 'shade name → factor of base (0..16) or "#rrggbb", e.g. {"dark":0.74,"light":1.22,"cap":1.42,"ridge":0.45}' },
        colors: { type: "array", items: { type: ["string", "integer"] }, minItems: 1, description: "Existing palette colors (hex or index) to adopt; first is the base" },
        names: { type: "array", items: { type: "string" }, description: "Shade names for `colors` (names[0] is ignored: always base). Default shade1, shade2, …" },
      },
      required: ["name"],
    },
  },
  {
    name: "recolor_slot",
    description: "Recolor a slot in the current scene: every palette entry of its ramp is re-derived from the new base (shade = factor × base), so all voxels painted with the slot change.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, base: { type: "string", description: "#rrggbb" } }, required: ["name", "base"] },
  },
  {
    name: "make_variant",
    description:
      "Make a color variant of the current scene WITHOUT changing it: recolors the given slots ({roof: \"#e8b830\", wall: \"#…\"}). " +
      "With save_as, saves it as models/<save_as>.json (in memory in scratch mode); with path, writes it to that absolute file and returns the variant's slot colors; otherwise returns the variant scene JSON.",
    inputSchema: {
      type: "object",
      properties: {
        slots: { type: "object", additionalProperties: { type: "string" }, description: "slot name → new base #rrggbb" },
        save_as: { type: "string", pattern: "^[A-Za-z0-9][\\w.-]{0,63}$" },
        path: { type: "string", description: "Absolute path: write the variant scene JSON there instead (works in scratch mode)" },
      },
      required: ["slots"],
    },
  },
  {
    name: "list_slots",
    description: "Material slots: {name: {base, colors: {shade: current hex}, factors: {shade: factor}}}.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_anchor",
    description:
      "Set (or replace) a named anchor saved with the scene: a cell the game needs, e.g. door (with dir \"+z\" = facing out the front), roof_top, seat, pivot. " +
      "Coordinates are integer cells and may lie outside the model or grid. A moving `translate` op carries anchors along (all, or those inside its box); mirror/clear don't; new_scene clears them.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_.-]{0,31}$" },
        x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" },
        dir: { type: "string", enum: ["+x", "-x", "+y", "-y", "+z", "-z"] },
        note: { type: "string" },
      },
      required: ["name", "x", "y", "z"],
    },
  },
  {
    name: "remove_anchor",
    description: "Remove a named anchor.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "list_anchors",
    description: "Anchors in the scene: {name: {x, y, z, dir?, note?}}.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "lint",
    description:
      "Check the model for silent mistakes: connected components (specks < speckSize voxels, floating pieces not resting on the floor or the main body), " +
      "enclosed air pockets, content touching the grid boundary (likely clipped), mirror symmetry across x and z (pivot in mirror-op convention), " +
      "unused and near-duplicate palette colors. Returns warnings + a one-line summary, then JSON. Flags skip checks on big grids.",
    inputSchema: {
      type: "object",
      properties: {
        components: { type: "boolean", description: "Components / specks / floating (default true)" },
        pockets: { type: "boolean", description: "Enclosed air (default true)" },
        boundary: { type: "boolean", description: "Grid-boundary contact (default true)" },
        symmetry: { type: "boolean", description: "Mirror symmetry scores (default true)" },
        palette: { type: "boolean", description: "Unused / near-duplicate colors (default true)" },
        speckSize: { type: "integer", minimum: 1, description: "Pieces smaller than this are specks (default 4)" },
        connectivity: { type: "integer", enum: [6, 18, 26], description: "Voxels join a piece through shared faces (6), faces+edges (18) or faces+edges+corners (26, default: what looks attached)" },
        floorY: { type: "integer", description: "Floor height for the floating check (default 0)" },
        nearColor: { type: "number", minimum: 0, description: "RGB distance for near-duplicate colors (default 20)" },
        maxList: { type: "integer", minimum: 1, description: "Max entries per list (default 20)" },
      },
    },
  },
];

export const INSTRUCTIONS = `Voxer is a voxel editor you control through these tools. Coordinates: integer cells, Y is up, the model's front faces +Z (the "front" view looks from +Z), x grows to the right in the front view. Default grid 32³ (new_scene can resize up to 256).
Workflow for building from a reference image + description: (1) get_reference / look at the image, decide the grid size and proportions; (2) block out big masses with box/ellipsoid/cylinder in one draw batch; (3) refine with layer ops (ASCII slices) and mirror for symmetry; sample_reference can turn the image into a ready-made layer; (4) snapshot (reference=true) after every pass, list concrete differences, fix them; (5) save_scene. Snapshots' ruler numbers are cell coordinates — use them to place things precisely.`;
