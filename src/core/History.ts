import type { Edit } from "./Tools";
import { applyEdit, revertEdit } from "./Tools";
import type { VoxelGrid } from "./VoxelGrid";

/** Undo/redo of edit strokes. A stroke is a group of edits (e.g. one mouse drag). */
export class History {
  private undoStack: Edit[][] = [];
  private redoStack: Edit[][] = [];
  private current: Edit[] | null = null;

  constructor(private grid: VoxelGrid, readonly limit = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  beginStroke(): void {
    if (this.current) this.endStroke();
    this.current = [];
  }

  /** Applies an edit to the grid and records it in the current stroke (or as its own stroke). */
  apply(e: Edit): void {
    applyEdit(this.grid, e);
    if (this.current) this.current.push(e);
    else this.push([e]);
  }

  endStroke(): void {
    const s = this.current;
    this.current = null;
    if (s && s.length) this.push(s);
  }

  undo(): Edit[] | null {
    this.endStroke();
    const s = this.undoStack.pop();
    if (!s) return null;
    for (let i = s.length - 1; i >= 0; i--) revertEdit(this.grid, s[i]!);
    this.redoStack.push(s);
    return s;
  }

  redo(): Edit[] | null {
    this.endStroke();
    const s = this.redoStack.pop();
    if (!s) return null;
    for (const e of s) applyEdit(this.grid, e);
    this.undoStack.push(s);
    return s;
  }

  private push(s: Edit[]) {
    this.undoStack.push(s);
    this.redoStack.length = 0;
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }
}
