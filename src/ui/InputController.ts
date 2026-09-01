import type { Editor } from "../core/Editor";
import type { Viewport } from "../render/Viewport";

type DragMode = "rotate" | "pan" | "paint" | "box";

/** Actions the controller can trigger but does not own (wired in `main.ts`). */
export interface InputActions {
  save?: () => void;
  saveAs?: () => void;
  open?: () => void;
}

/**
 * Mouse / trackpad / keyboard bindings.
 *  Mouse:    left = tool (drag to keep applying), right-drag = orbit, middle or shift+left = pan, wheel = zoom
 *            box tool: drag the footprint, release, move to set the height, click to place (Esc cancels)
 *  Trackpad: scroll / pinch = zoom, alt+drag or alt+scroll = orbit, shift+drag = pan
 *  Keys:     1/2/3 or B/E/P tools, Tab next tool, [ ] color, Cmd/Ctrl+Z undo, Shift+Cmd+Z / Cmd+Y redo,
 *            Cmd+S save, Shift+Cmd+S save as, Cmd+O open, F reset view, G toggle grid,
 *            W toggle voxel outlines, C perspective/orthographic, Esc cancel a box, Space+drag orbit
 */
export class InputController {
  private drag: { mode: DragMode; x: number; y: number } | null = null;
  private spaceHeld = false;

  constructor(private editor: Editor, private view: Viewport, private actions: InputActions = {}) {
    const c = view.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", (e) => this.onUp(e));
    c.addEventListener("pointerleave", () => {
      if (this.drag) return;
      view.showGhost(null);
      editor.setHover(null);
    });
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("keyup", (e) => { if (e.key === " ") this.spaceHeld = false; });
  }

  private dragModeFor(e: PointerEvent): DragMode | null {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) return "pan";
    if (e.button === 2 || (e.button === 0 && (e.altKey || this.spaceHeld))) return "rotate";
    if (e.button !== 0) return null;
    return this.editor.tool === "box" ? "box" : "paint";
  }

  private applyAt(x: number, y: number): void {
    const hit = this.view.pick(this.editor.grid, x, y);
    if (hit) this.editor.applyTool(hit);
  }

  private updateGhost(x: number, y: number): void {
    const hit = this.view.pick(this.editor.grid, x, y);
    const cell = this.editor.previewCell(hit);
    const color = this.editor.tool === "eraser" ? "#ff3333" : this.editor.colorHex;
    this.view.showGhost(cell, color);
    // The readout follows the ghost, falling back to the cell actually under the pointer.
    this.editor.setHover(cell ?? hit?.cell ?? null);
  }

  private onDown(e: PointerEvent): void {
    const mode = this.dragModeFor(e);
    if (!mode) return;
    try { this.view.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    if (mode === "box") {
      // Second click: the height is set, place the box. First click: start the footprint.
      if (this.editor.boxDraft?.phase === "height") { this.editor.commitBox(); return; }
      const hit = this.view.pick(this.editor.grid, e.clientX, e.clientY);
      const start = this.editor.previewCell(hit);
      if (!start) return;
      this.drag = { mode, x: e.clientX, y: e.clientY };
      this.view.showGhost(null);
      this.editor.beginBox(start);
      return;
    }
    this.drag = { mode, x: e.clientX, y: e.clientY };
    if (mode === "paint") {
      this.editor.beginStroke(this.view.viewDirection());
      this.applyAt(e.clientX, e.clientY);
      this.updateGhost(e.clientX, e.clientY);
    } else this.view.showGhost(null);
  }

  private onMove(e: PointerEvent): void {
    const draft = this.editor.boxDraft;
    if (draft) { this.trackBox(draft.phase, e.clientX, e.clientY); return; }
    if (!this.drag) { this.updateGhost(e.clientX, e.clientY); return; }
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX; this.drag.y = e.clientY;
    switch (this.drag.mode) {
      case "rotate": this.view.orbit.rotate(dx, dy); break;
      case "pan": this.view.orbit.pan(dx, dy); break;
      case "paint": this.applyAt(e.clientX, e.clientY); this.updateGhost(e.clientX, e.clientY); break;
      case "box": break; // handled above, off the draft rather than the drag
    }
    this.view.invalidate();
  }

  private onUp(e: PointerEvent): void {
    if (this.drag?.mode === "paint") this.editor.endStroke();
    // Releasing after the footprint drag hands the pointer over to the height phase.
    if (this.drag?.mode === "box" && this.editor.boxDraft?.phase === "rect") this.editor.beginBoxHeight();
    this.drag = null;
    if (!this.editor.boxDraft) this.updateGhost(e.clientX, e.clientY);
  }

  /** Feeds pointer position into the box being drawn: footprint corner, then height. */
  private trackBox(phase: "rect" | "height", x: number, y: number): void {
    const anchor = this.editor.boxAnchor;
    if (!anchor) return;
    if (phase === "rect") {
      const cell = this.view.planeCell(x, y, anchor.y, this.editor.grid);
      if (cell) this.editor.setBoxCorner(cell);
    } else {
      const h = this.view.heightAt(x, y, anchor);
      if (h !== null) this.editor.setBoxTop(Math.floor(h));
    }
    // Readout follows the moving corner of the box, after it has been updated.
    this.editor.setHover(this.editor.boxDraft?.region.max ?? null);
    this.view.invalidate();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : 1; // line-mode wheels
    const dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.altKey) this.view.orbit.rotate(dx, dy);
    else if (e.shiftKey) this.view.orbit.pan(dx || dy, 0);
    else this.view.orbit.zoom(e.ctrlKey ? dy * 5 : dy); // ctrlKey = trackpad pinch
    this.view.invalidate();
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") { e.preventDefault(); e.shiftKey ? this.editor.redo() : this.editor.undo(); return; }
    if (mod && key === "y") { e.preventDefault(); this.editor.redo(); return; }
    if (mod && key === "s") { e.preventDefault(); (e.shiftKey ? this.actions.saveAs : this.actions.save)?.(); return; }
    if (mod && key === "o") { e.preventDefault(); this.actions.open?.(); return; }
    if (mod) return;
    switch (key) {
      case "1": case "b": this.editor.setTool("pen"); break;
      case "4": case "x": this.editor.setTool("box"); break;
      case "2": case "e": this.editor.setTool("eraser"); break;
      case "3": case "p": this.editor.setTool("paint"); break;
      case "tab": e.preventDefault(); this.editor.nextTool(); break;
      case "[": this.editor.stepColor(-1); break;
      case "]": this.editor.stepColor(1); break;
      case "f": this.view.orbit.reset(); this.view.invalidate(); break;
      case "g": this.view.toggleGrid(); break;
      case "w": this.view.toggleEdges(); break;
      case "c": this.view.toggleProjection(); break;
      case "escape": this.editor.cancelBox(); break;
      case " ": this.spaceHeld = true; e.preventDefault(); break;
    }
  }
}
