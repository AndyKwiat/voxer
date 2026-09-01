import { Emitter } from "./Emitter";
import { History } from "./History";
import { Palette } from "./Palette";
import { decodeScene, encodeScene, type SceneFile } from "./Scene";
import type { Hit, Vec3 } from "./Raycast";
import {
  dominantAxis, inPlane, makeBoxRegion, planBoxEdits, planEdit, targetCell, TOOLS,
  type Axis, type BoxRegion, type Edit, type ToolName,
} from "./Tools";
import { VoxelGrid } from "./VoxelGrid";

export type EditorEvents = {
  /** Voxels changed (edit, undo or redo). */
  voxels: [edits: readonly Edit[]];
  tool: [tool: ToolName];
  color: [index: number];
  /** A palette entry was added or edited. */
  palette: [];
  /** The current scene's name or unsaved-changes flag changed. */
  scene: [name: string | null, dirty: boolean];
  /** In-progress box changed (null when there is none). */
  box: [draft: BoxDraft | null];
};

/**
 * A box being drawn. `rect` = dragging the footprint on the plane of the first cell;
 * `height` = button released, pointer now sets the top.
 */
export interface BoxDraft {
  phase: "rect" | "height";
  region: BoxRegion;
}

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
  private _box: { anchor: Vec3; corner: Vec3; topY: number; phase: "rect" | "height" } | null = null;
  private _sceneName: string | null = null;
  private _dirty = false;
  /** Fields from a loaded file this build does not know about; written back on save. */
  private _extra: Record<string, unknown> = {};

  constructor(grid = new VoxelGrid(), palette = new Palette()) {
    super();
    this.grid = grid;
    this.palette = palette;
    this.history = new History(grid);
    palette.onChange.add(() => { this.markDirty(); this.emit("palette"); });
    this.on("voxels", () => this.markDirty());
  }

  get tool(): ToolName {
    return this._tool;
  }
  setTool(t: ToolName): void {
    if (t === this._tool) return;
    if (this._box) this.clearBox(); // leaving the box tool mid-draw discards it
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

  /** Cell the current tool would affect for a hit (for previews). The box preview is its own event. */
  previewCell(hit: Hit | null): Vec3 | null {
    if (this._box) return null;
    const c = hit ? targetCell(this._tool, hit, this.grid) : null;
    return c && this.inStrokePlane(c) ? c : null;
  }

  // ---- box tool: click-drag a footprint, release, move to set height, click to commit ----

  /** The box being drawn, or null. */
  get boxDraft(): BoxDraft | null {
    if (!this._box) return null;
    const { anchor, corner, topY, phase } = this._box;
    return { phase, region: makeBoxRegion(anchor, corner, topY, this.grid.size) };
  }

  /** The cell the box started from (fixes the footprint plane), or null. */
  get boxAnchor(): Vec3 | null {
    return this._box ? { ...this._box.anchor } : null;
  }

  private emitBox(): void {
    this.emit("box", this.boxDraft);
  }

  private clearBox(): void {
    this._box = null;
    this.emit("box", null);
  }

  /** Starts a box at `cell`; its horizontal plane is fixed here for the rest of the draw. */
  beginBox(cell: Vec3): void {
    this._box = { anchor: { ...cell }, corner: { ...cell }, topY: cell.y, phase: "rect" };
    this.emitBox();
  }

  /** Rect phase: moves the opposite footprint corner (the y of `cell` is ignored). */
  setBoxCorner(cell: Vec3): void {
    if (this._box?.phase !== "rect") return;
    this._box.corner = { x: cell.x, y: this._box.anchor.y, z: cell.z };
    this.emitBox();
  }

  /** Footprint done (pointer released): the pointer now drives the height. */
  beginBoxHeight(): void {
    if (this._box?.phase !== "rect") return;
    this._box.phase = "height";
    this.emitBox();
  }

  /** Height phase: sets the top cell row (may be below the anchor for a downward box). */
  setBoxTop(y: number): void {
    if (this._box?.phase !== "height") return;
    const next = Math.max(0, Math.min(this.grid.size - 1, Math.round(y)));
    if (next === this._box.topY) return;
    this._box.topY = next;
    this.emitBox();
  }

  /** Fills the box as one undoable stroke. Returns the edits made (empty if it was fully occupied). */
  commitBox(): Edit[] {
    const draft = this.boxDraft;
    if (!draft) return [];
    const edits = planBoxEdits(this.grid, draft.region, Palette.toCell(this._color));
    this.clearBox();
    if (!edits.length) return [];
    this.history.beginStroke();
    for (const e of edits) this.history.apply(e);
    this.history.endStroke();
    this.emit("voxels", edits);
    return edits;
  }

  /** Escape: throw the box away and fall back to the default tool. */
  cancelBox(): void {
    if (!this._box) return;
    this.clearBox();
    this.setTool("pen");
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

  /** Name the scene was last saved as / loaded from, or null if it has never been named. */
  get sceneName(): string | null {
    return this._sceneName;
  }
  /** True when there are edits since the last save or load. */
  get dirty(): boolean {
    return this._dirty;
  }
  private markDirty(): void {
    if (this._dirty) return;
    this._dirty = true;
    this.emit("scene", this._sceneName, true);
  }
  /** Records that the current state is what `name` holds on disk. */
  markSaved(name: string): void {
    this._sceneName = name;
    this._dirty = false;
    this.emit("scene", name, false);
  }

  /** Serializes the current grid + palette. `extra` fields from the loaded file are carried over. */
  toScene(): SceneFile {
    return encodeScene(this.grid, this.palette.all(), this._extra);
  }

  /**
   * Replaces grid + palette from a scene document. Emits one `voxels` event covering every changed
   * cell, drops undo history, and (with a name) marks the scene clean.
   */
  loadScene(doc: unknown, name: string | null = null): void {
    const scene = decodeScene(doc);
    if (scene.size !== this.grid.size) {
      throw new Error(`scene is ${scene.size}³ but this editor holds a ${this.grid.size}³ grid`);
    }
    this.palette.setAll(scene.palette);
    const edits: Edit[] = [];
    const s = this.grid.size;
    for (let i = 0; i < scene.cells.length; i++) {
      const after = scene.cells[i]!;
      const before = this.grid.data[i]!;
      if (before === after) continue;
      const x = i % s, z = Math.floor(i / s) % s, y = Math.floor(i / (s * s));
      this.grid.set(x, y, z, after);
      edits.push({ x, y, z, before, after });
    }
    this._extra = scene.extra;
    this.history.clear();
    if (this._color >= this.palette.length) this._color = 0;
    this.emit("voxels", edits);
    this._sceneName = name;
    this._dirty = false;
    this.emit("scene", name, false);
  }

  /** Bulk-sets a cell outside of history (used for demo/loading). */
  setRaw(x: number, y: number, z: number, value: number): void {
    const before = this.grid.set(x, y, z, value);
    this.emit("voxels", [{ x, y, z, before, after: value }]);
  }
}
