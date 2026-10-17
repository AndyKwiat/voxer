import { boundingBox, colorCounts, dumpLayer, planOps, planOpsReport, type Op } from "./Commands";
import type { WriteReport } from "./Report";
import { Emitter } from "./Emitter";
import { History } from "./History";
import { Palette } from "./Palette";
import { withHexOf, type HexAwareResolver } from "./Parts";
import type { Hit, Vec3 } from "./Raycast";
import { dominantAxis, inPlane, planEdit, targetCell, TOOLS, type Axis, type Edit, type ToolName } from "./Tools";
import { decodeCells, encodeCells, SCENE_VERSIONS, type SceneData } from "./Scene";
import { VoxelGrid } from "./VoxelGrid";
import { anchorMoves, checkAnchor, checkAnchorName, parseAnchors, type Anchor, type Anchors } from "./Anchors";
import { checkHex, parseSlots, planAdoptSlot, planDefineSlot, recolorSlot, slotSummary, variantScene, type Slots } from "./Slots";

export type EditorEvents = {
  /** Voxels changed (edit, undo or redo). */
  voxels: [edits: readonly Edit[]];
  tool: [tool: ToolName];
  color: [index: number];
  /** A palette entry was added or edited. */
  palette: [];
  /** The grid was replaced or bulk-loaded (`load`/`newScene`): views rebuild everything. */
  reset: [];
  /** Slots or anchors changed (scene metadata that isn't voxels or palette). */
  meta: [];
};

/** All editor state and operations, independent of DOM and rendering. */
export class Editor extends Emitter<EditorEvents> {
  private _grid: VoxelGrid;
  readonly palette: Palette;
  private _history: History;
  private _tool: ToolName = "pen";
  private _color = 0;
  /** First cell the pen placed in the current stroke; later cells must stay in its locked plane. */
  private _anchor: Vec3 | null = null;
  /** Normal of that plane, chosen from the view direction when the stroke began. */
  private _lockAxis: Axis = "y";
  private _slots: Slots = {};
  private _anchors: Anchors = {};
  /** Anchor moves made by a `run` step, keyed by that step's first edit (History hands the same objects back on undo/redo). */
  private anchorSteps = new WeakMap<Edit, { name: string; from: Anchor; to: Anchor }[]>();

  constructor(grid = new VoxelGrid(), palette = new Palette()) {
    super();
    this._grid = grid;
    this.palette = palette;
    this._history = new History(grid);
    palette.onChange.add(() => this.emit("palette"));
    palette.onChange.add(() => this.pruneSlots());
  }

  /** Current grid. Replaced (not mutated in size) by `load`/`newScene`, which emit `reset`. */
  get grid(): VoxelGrid {
    return this._grid;
  }
  get history(): History {
    return this._history;
  }

  get tool(): ToolName {
    return this._tool;
  }
  setTool(t: ToolName): void {
    if (t === this._tool) return;
    this._tool = t;
    this.emit("tool", t);
  }
  nextTool(): void {
    this.setTool(TOOLS[(TOOLS.indexOf(this._tool) + 1) % TOOLS.length]!);
  }

  /** Selected palette index. */
  get color(): number {
    return this._color;
  }
  get colorHex(): string {
    return this.palette.get(this._color) ?? "#ffffff";
  }
  setColor(i: number): void {
    if (i < 0 || i >= this.palette.length || i === this._color) return;
    this._color = i;
    this.emit("color", i);
  }
  stepColor(d: number): void {
    const n = this.palette.length;
    this.setColor((((this._color + d) % n) + n) % n);
  }
  addColor(hex: string): void {
    this.setColor(this.palette.add(hex));
  }

  /** Plane the current pen stroke is locked to, if it has placed a voxel yet. */
  get strokePlane(): { axis: Axis; value: number } | null {
    return this._anchor ? { axis: this._lockAxis, value: this._anchor[this._lockAxis] } : null;
  }

  /** False if the pen stroke is anchored and `c` is off its locked plane. */
  private inStrokePlane(c: Vec3): boolean {
    return this._tool !== "pen" || !this._anchor || inPlane(this._anchor, c, this._lockAxis);
  }

  /** Cell the current tool would affect for a hit (for previews). */
  previewCell(hit: Hit | null): Vec3 | null {
    const c = hit ? targetCell(this._tool, hit, this.grid) : null;
    return c && this.inStrokePlane(c) ? c : null;
  }

  /** Applies the current tool at a hit. Returns the edit made, if any. */
  applyTool(hit: Hit): Edit | null {
    const e = planEdit(this._tool, hit, this.grid, Palette.toCell(this._color));
    if (!e || !this.inStrokePlane(e)) return null;
    this.history.apply(e);
    this.emit("voxels", [e]);
    if (this._tool === "pen" && !this._anchor) this._anchor = { x: e.x, y: e.y, z: e.z };
    return e;
  }

  /**
   * Starts an undo stroke. `viewDir` (camera forward) picks the plane a held pen stroke locks to:
   * the one most face-on to the camera, e.g. the horizontal x-z plane when looking top-down.
   * Defaults to that horizontal plane when no direction is given.
   */
  beginStroke(viewDir?: Vec3): void {
    this._anchor = null;
    this._lockAxis = viewDir ? dominantAxis(viewDir) : "y";
    this.history.beginStroke();
  }
  endStroke(): void {
    this._anchor = null;
    this.history.endStroke();
  }

  undo(): boolean {
    const s = this.history.undo();
    if (s) { this.emit("voxels", s); this.replayAnchors(s, "undo"); }
    return !!s;
  }
  redo(): boolean {
    const s = this.history.redo();
    if (s) { this.emit("voxels", s); this.replayAnchors(s, "redo"); }
    return !!s;
  }

  /** Applies edits as one undo step and one `voxels` event. */
  applyEdits(edits: readonly Edit[]): void {
    if (!edits.length) return;
    this._history.beginStroke();
    for (const e of edits) this._history.apply(e);
    this._history.endStroke();
    this.emit("voxels", edits);
  }

  /**
   * Runs drawing ops (see `Commands.ts`) as one undo step. Hex colors are resolved through the palette
   * (added when missing). Atomic: if any op is malformed nothing is applied. Returns cells changed.
   */
  run(ops: readonly Op[]): number {
    return this.runReport(ops).changed;
  }

  /** `run` that also returns a write report (totals, per-op counts, clipping, same-batch overwrites). */
  runReport(ops: readonly Op[]): { changed: number; report: WriteReport } {
    const { edits, report } = planOpsReport(this._grid, ops, this.resolver());
    this.applyEdits(edits);
    // A moving `translate` carries anchors along (see `anchorMoves`); undo/redo of the step moves them back.
    const moves = edits.length ? anchorMoves(this._anchors, ops) : [];
    if (moves.length) {
      this.anchorSteps.set(edits[0]!, moves);
      this._anchors = { ...this._anchors, ...Object.fromEntries(moves.map((m) => [m.name, m.to])) };
      this.emit("meta");
    }
    return { changed: edits.length, report };
  }

  /** Summary for agents/status: size, count, bounding box, colors in use. */
  info() {
    const counts = [...colorCounts(this._grid)].sort((a, b) => b[1] - a[1]);
    return {
      size: this._grid.size,
      count: this._grid.count,
      bbox: boundingBox(this._grid),
      colorsUsed: counts.map(([v, n]) => ({ index: Palette.fromCell(v), hex: this.palette.get(Palette.fromCell(v)) ?? "?", count: n })),
      palette: [...this.palette.all()],
      canUndo: this._history.canUndo,
      canRedo: this._history.canRedo,
      slots: this.listSlots(),
      anchors: this.anchors,
    };
  }

  /** ASCII dump of one slice in `layer` op layout. */
  dumpLayer(axis: Axis, index: number, crop?: { a0: number; a1: number; b0: number; b1: number }) {
    return dumpLayer(this._grid, axis, index, (v) => this.palette.get(Palette.fromCell(v)) ?? "?", crop);
  }

  /** Version 1 unless the scene has slots or anchors (then 2, with those fields). */
  serialize(): SceneData {
    const scene: SceneData = { version: 1, size: this._grid.size, palette: [...this.palette.all()], data: encodeCells(this._grid.data) };
    const hasSlots = Object.keys(this._slots).length > 0, hasAnchors = Object.keys(this._anchors).length > 0;
    if (hasSlots || hasAnchors) scene.version = 2;
    if (hasSlots) scene.slots = structuredClone(this._slots);
    if (hasAnchors) scene.anchors = structuredClone(this._anchors);
    return scene;
  }

  /** Replaces grid + palette (+ slots, anchors) from saved data (clears history). Reads versions 1 and 2. */
  load(scene: SceneData): void {
    if (!SCENE_VERSIONS.includes(scene.version)) throw new Error(`unsupported scene version ${scene.version}`);
    const grid = new VoxelGrid(scene.size);
    grid.setAll(decodeCells(scene.data, scene.size ** 3));
    const slots = parseSlots(scene.slots, scene.palette.length), anchors = parseAnchors(scene.anchors);
    this.palette.replaceAll(scene.palette);
    this._slots = slots;
    this._anchors = anchors;
    this.replaceGrid(grid);
    this.emit("meta");
  }

  /** Empty scene of a given size (clears history, slots and anchors); optionally replaces the palette. */
  newScene(size = this._grid.size, palette?: readonly string[]): void {
    if (palette) this.palette.replaceAll(palette);
    this._slots = {};
    this._anchors = {};
    this.replaceGrid(new VoxelGrid(size));
    this.emit("meta");
  }

  // ---------- material slots (core/Slots.ts) ----------

  get slots(): Readonly<Slots> {
    return this._slots;
  }

  /** `{roof: {base, colors: {base: "#…", dark: "#…"}, factors}}` with current palette hexes. */
  listSlots() {
    return slotSummary(this._slots, this.palette.all());
  }

  /**
   * Creates (or redefines) a slot from a base color: adds the ramp's colors to the palette (a redefinition
   * reuses its entries by shade name, recoloring voxels already painted with them) and returns the hexes.
   * `shades` values are factors of the base (`dark: 0.74`) or explicit hexes.
   */
  defineSlot(name: string, base: string, shades?: Record<string, number | string>) {
    const { palette, slot } = planDefineSlot(this.palette.all(), this._slots, name, base, shades);
    this._slots = { ...this._slots, [name]: slot };
    this.palette.replaceAll(palette);
    this.emit("meta");
    return this.listSlots()[name]!;
  }

  /** Makes existing palette colors (hex or index; first = base) a slot without changing them. */
  adoptSlot(name: string, colors: (string | number)[], names?: string[]) {
    const slot = planAdoptSlot(this.palette.all(), this._slots, name, colors, names);
    this._slots = { ...this._slots, [name]: slot };
    this.emit("meta");
    return this.listSlots()[name]!;
  }

  /** Re-derives every palette entry of a slot from a new base (so all its voxels change color). */
  recolorSlot(name: string, base: string) {
    const r = recolorSlot(this.palette.all(), this._slots, name, base);
    this._slots = { ...this._slots, [name]: r.slot };
    this.palette.replaceAll(r.palette);
    this.emit("meta");
    return this.listSlots()[name]!;
  }

  /** The current scene with some slots recolored, e.g. `{roof: "#e8b830"}`. Does not change this editor. */
  makeVariant(changes: Record<string, string>): SceneData {
    for (const v of Object.values(changes ?? {})) checkHex(v);
    return variantScene(this.serialize(), changes);
  }

  /** Drops slots whose palette entries no longer exist (e.g. after `set_palette` shrank the palette). */
  private pruneSlots(): void {
    const n = this.palette.length;
    const bad = Object.entries(this._slots).filter(([, s]) => Object.values(s.shades).some((sh) => sh.index >= n));
    if (!bad.length) return;
    this._slots = Object.fromEntries(Object.entries(this._slots).filter(([k]) => !bad.some(([b]) => b === k)));
    this.emit("meta");
  }

  // ---------- anchors (core/Anchors.ts) ----------

  get anchors(): Readonly<Anchors> {
    return this._anchors;
  }

  setAnchor(name: string, a: Anchor): Anchor {
    const v = checkAnchor(checkAnchorName(name), a);
    this._anchors = { ...this._anchors, [name]: v };
    this.emit("meta");
    return v;
  }

  removeAnchor(name: string): boolean {
    if (!(name in this._anchors)) return false;
    const { [name]: _, ...rest } = this._anchors;
    this._anchors = rest;
    this.emit("meta");
    return true;
  }

  private replayAnchors(stroke: readonly Edit[], dir: "undo" | "redo"): void {
    const moves = stroke[0] && this.anchorSteps.get(stroke[0]);
    if (!moves) return;
    let changed = false;
    for (const m of moves) {
      const [want, to] = dir === "undo" ? [m.to, m.from] : [m.from, m.to];
      const cur = this._anchors[m.name];
      // Only move an anchor that is still where this step left it (it may have been set or removed since).
      if (cur && cur.x === want.x && cur.y === want.y && cur.z === want.z) { this._anchors = { ...this._anchors, [m.name]: { ...cur, x: to.x, y: to.y, z: to.z } }; changed = true; }
    }
    if (changed) this.emit("meta");
  }

  private replaceGrid(grid: VoxelGrid): void {
    this._grid = grid;
    this._history = new History(grid);
    this._anchor = null;
    if (this._color >= this.palette.length) this.setColor(0);
    this.emit("reset");
  }

  /** Color → cell resolver for ops (hex added to the palette); can map cells back to hex for shade ramps. */
  resolver(): HexAwareResolver {
    return withHexOf((c) => Palette.toCell(this.palette.resolve(c)), (v) => this.palette.get(Palette.fromCell(v)));
  }

  /** Bulk-sets a cell outside of history (used for demo/loading). */
  setRaw(x: number, y: number, z: number, value: number): void {
    const before = this.grid.set(x, y, z, value);
    this.emit("voxels", [{ x, y, z, before, after: value }]);
  }
}
