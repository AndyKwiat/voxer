import { Emitter } from "./Emitter";
import { History } from "./History";
import { Palette } from "./Palette";
import type { Hit, Vec3 } from "./Raycast";
import { dominantAxis, inPlane, planEdit, targetCell, TOOLS, type Axis, type Edit, type ToolName } from "./Tools";
import { VoxelGrid } from "./VoxelGrid";

export type EditorEvents = {
  /** Voxels changed (edit, undo or redo). */
  voxels: [edits: readonly Edit[]];
  tool: [tool: ToolName];
  color: [index: number];
  /** A palette entry was added or edited. */
  palette: [];
};

/** All editor state and operations, independent of DOM and rendering. */
export class Editor extends Emitter<EditorEvents> {
  readonly grid: VoxelGrid;
  readonly palette: Palette;
  readonly history: History;
  private _tool: ToolName = "pen";
  private _color = 0;
  /** First cell the pen placed in the current stroke; later cells must stay in its locked plane. */
  private _anchor: Vec3 | null = null;
  /** Normal of that plane, chosen from the view direction when the stroke began. */
  private _lockAxis: Axis = "y";

  constructor(grid = new VoxelGrid(), palette = new Palette()) {
    super();
    this.grid = grid;
    this.palette = palette;
    this.history = new History(grid);
    palette.onChange.add(() => this.emit("palette"));
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

  /** Bulk-sets a cell outside of history (used for demo/loading). */
  setRaw(x: number, y: number, z: number, value: number): void {
    const before = this.grid.set(x, y, z, value);
    this.emit("voxels", [{ x, y, z, before, after: value }]);
  }
}
