import { boundingBox, colorCounts, dumpLayer, planOps, type Op } from "./Commands";
import { Emitter } from "./Emitter";
import { History } from "./History";
import { Palette } from "./Palette";
import { withHexOf, type HexAwareResolver } from "./Parts";
import type { Hit, Vec3 } from "./Raycast";
import { dominantAxis, inPlane, planEdit, targetCell, TOOLS, type Axis, type Edit, type ToolName } from "./Tools";
import { decodeCells, encodeCells, type SceneData } from "./Scene";
import { VoxelGrid } from "./VoxelGrid";

export type EditorEvents = {
  /** Voxels changed (edit, undo or redo). */
  voxels: [edits: readonly Edit[]];
  tool: [tool: ToolName];
  color: [index: number];
  /** A palette entry was added or edited. */
  palette: [];
  /** The grid was replaced or bulk-loaded (`load`/`newScene`): views rebuild everything. */
  reset: [];
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

  constructor(grid = new VoxelGrid(), palette = new Palette()) {
    super();
    this._grid = grid;
    this.palette = palette;
    this._history = new History(grid);
    palette.onChange.add(() => this.emit("palette"));
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
    if (s) this.emit("voxels", s);
    return !!s;
  }
  redo(): boolean {
    const s = this.history.redo();
    if (s) this.emit("voxels", s);
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
    const edits = planOps(this._grid, ops, this.resolver());
    this.applyEdits(edits);
    return edits.length;
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
    };
  }

  /** ASCII dump of one slice in `layer` op layout. */
  dumpLayer(axis: Axis, index: number, crop?: { a0: number; a1: number; b0: number; b1: number }) {
    return dumpLayer(this._grid, axis, index, (v) => this.palette.get(Palette.fromCell(v)) ?? "?", crop);
  }

  serialize(): SceneData {
    return { version: 1, size: this._grid.size, palette: [...this.palette.all()], data: encodeCells(this._grid.data) };
  }

  /** Replaces grid + palette from saved data (clears history). */
  load(scene: SceneData): void {
    if (scene.version !== 1) throw new Error(`unsupported scene version ${scene.version}`);
    const grid = new VoxelGrid(scene.size);
    grid.setAll(decodeCells(scene.data, scene.size ** 3));
    this.palette.replaceAll(scene.palette);
    this.replaceGrid(grid);
  }

  /** Empty scene of a given size (clears history); optionally replaces the palette. */
  newScene(size = this._grid.size, palette?: readonly string[]): void {
    if (palette) this.palette.replaceAll(palette);
    this.replaceGrid(new VoxelGrid(size));
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
