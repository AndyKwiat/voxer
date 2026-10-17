/** MCP tool definitions (JSON Schema) for the Voxer server. Kept separate from transport/plumbing. */

const vec3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z] cell coordinates" };
const color = { type: ["string", "integer"], description: 'Hex "#rrggbb" (auto-added to the palette) or palette index' };
const axis = { type: "string", enum: ["x", "y", "z"] };
const shape = { color, erase: { type: "boolean", description: "Carve (set empty) instead of filling" } };

const OP_SCHEMAS = [
  { properties: { op: { const: "box" }, min: vec3, max: vec3, ...shape, hollow: { type: "boolean" } }, required: ["op", "min", "max"],
    description: "Axis-aligned box, inclusive bounds." },
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
      "Ops: box, ellipsoid, cylinder, line, layer (ASCII slices — the best way to paint detail), set, mirror, translate, replace_color, clear.",
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
      "Render a labeled contact sheet (one PNG). Axis views are orthographic with a cell grid and rulers (numbers = cell coordinates); " +
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
    description: "Save the current scene as models/<name>.json.",
    inputSchema: { type: "object", properties: { name: { type: "string", pattern: "^[A-Za-z0-9][\\w.-]{0,63}$" } }, required: ["name"] },
  },
  {
    name: "load_scene",
    description: "Load models/<name>.json (replaces the current scene, clears undo).",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
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
];

export const INSTRUCTIONS = `Voxer is a voxel editor you control through these tools. Coordinates: integer cells, Y is up, the model's front faces +Z (the "front" view looks from +Z), x grows to the right in the front view. Default grid 32³ (new_scene can resize up to 256).
Workflow for building from a reference image + description: (1) get_reference / look at the image, decide the grid size and proportions; (2) block out big masses with box/ellipsoid/cylinder in one draw batch; (3) refine with layer ops (ASCII slices) and mirror for symmetry; sample_reference can turn the image into a ready-made layer; (4) snapshot (reference=true) after every pass, list concrete differences, fix them; (5) save_scene. Snapshots' ruler numbers are cell coordinates — use them to place things precisely.`;
