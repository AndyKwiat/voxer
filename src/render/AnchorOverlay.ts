import * as THREE from "three";
import { dirVector, type Anchor, type Anchors } from "../core/Anchors";
import {
  AXIS_VIEW_DEFS, isAxisView, isoCamera, orthoFrame, toScreen,
  type AxisView, type Box3, type IsoViewName, type ViewName,
} from "./Views";

/**
 * Anchor markers drawn on snapshot tiles (`Capture.snapshotSheet` calls `drawAnchorOverlays` after the
 * tiles are rendered). Axis views: the anchor's cell outlined + its name + an arrow for `dir` (⊙ / ⊗ when
 * `dir` points at / away from the camera). Iso views: a dot with the name and a short `dir` arrow.
 * Markers are annotations: always drawn on top, even when the cell is hidden behind voxels.
 */

/** Where pictures sit inside each tile canvas, and how they were framed. */
export interface OverlayLayout {
  box: Box3;
  gridSize: number;
  /** Picture size in pixels; the picture's top-left is at (ox, oy) in the tile. */
  px: number;
  ox: number;
  oy: number;
}

const COLORS = ["#ffd400", "#ff4fd8", "#3ef0ff", "#7dff5a", "#ff8a3d"];
const FONT = "bold 11px ui-monospace, Menlo, monospace";

/** Snapshot `anchors` option: explicit true/false, else on when the scene has any. */
export function anchorsShown(opt: boolean | undefined, anchors: Anchors): boolean {
  return opt ?? Object.keys(anchors).length > 0;
}

/** `box` grown to include every anchor cell (and 2 cells of its `dir` arrow), so markers stay in frame. Pure. */
export function frameWithAnchors(box: Box3, anchors: Anchors): Box3 {
  const min = { ...box.min }, max = { ...box.max };
  for (const a of Object.values(anchors)) {
    const d = a.dir ? dirVector(a.dir) : { x: 0, y: 0, z: 0 };
    for (const k of ["x", "y", "z"] as const) {
      min[k] = Math.min(min[k], a[k] + Math.min(0, d[k] * 2));
      max[k] = Math.max(max[k], a[k] + 1 + Math.max(0, d[k] * 2));
    }
  }
  return { min, max };
}

/** Screen geometry of an anchor in an axis view (pixels inside the picture). Pure. */
export function axisMarker(v: AxisView, box: Box3, gridSize: number, px: number, a: Anchor) {
  const f = orthoFrame(v, box, gridSize);
  const u = a[v.right.axis], w = a[v.screenUp.axis];
  const p0 = toScreen(f, px, u, w), p1 = toScreen(f, px, u + 1, w + 1);
  const rect = { x: Math.min(p0.sx, p1.sx), y: Math.min(p0.sy, p1.sy), w: Math.abs(p1.sx - p0.sx), h: Math.abs(p1.sy - p0.sy) };
  let arrow: { dx: number; dy: number } | null = null, facing: "toward" | "away" | null = null;
  if (a.dir) {
    const d = dirVector(a.dir);
    const dx = v.right.sign * d[v.right.axis] + 0, dy = -v.screenUp.sign * d[v.screenUp.axis] + 0;
    if (dx || dy) arrow = { dx, dy };
    else facing = d.x * v.forward.x + d.y * v.forward.y + d.z * v.forward.z < 0 ? "toward" : "away";
  }
  return { rect, arrow, facing };
}

export function drawAnchorOverlays(tiles: readonly HTMLCanvasElement[], views: readonly ViewName[], anchors: Anchors, L: OverlayLayout): void {
  const list = Object.entries(anchors);
  if (!list.length) return;
  views.forEach((name, i) => {
    const tile = tiles[i];
    if (!tile) return;
    const g = tile.getContext("2d")!;
    g.save();
    g.beginPath();
    g.rect(L.ox, L.oy, L.px, L.px);
    g.clip();
    g.translate(L.ox, L.oy);
    g.font = FONT;
    g.lineJoin = "round";
    if (isAxisView(name)) list.forEach(([n, a], k) => drawAxis(g, AXIS_VIEW_DEFS[name], L, n, a, COLORS[k % COLORS.length]!));
    else {
      const project = isoProjector(name, L);
      list.forEach(([n, a], k) => drawIso(g, project, n, a, COLORS[k % COLORS.length]!));
    }
    g.restore();
  });
}

function drawAxis(g: CanvasRenderingContext2D, v: AxisView, L: OverlayLayout, name: string, a: Anchor, color: string): void {
  const { rect: r, arrow, facing } = axisMarker(v, L.box, L.gridSize, L.px, a);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  g.fillStyle = color + "55";
  g.fillRect(r.x, r.y, r.w, r.h);
  g.lineWidth = 2;
  g.strokeStyle = "#000";
  g.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  g.strokeStyle = color;
  g.strokeRect(r.x, r.y, r.w, r.h);
  const len = Math.max(r.w * 2.5, 22);
  if (arrow) drawArrow(g, cx, cy, cx + arrow.dx * len, cy + arrow.dy * len, color);
  if (facing) {
    const rad = Math.max(5, Math.min(r.w, r.h) * 0.35);
    g.lineWidth = 2;
    g.strokeStyle = "#000";
    g.beginPath(); g.arc(cx, cy, rad + 1, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = color;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.stroke();
    g.fillStyle = color;
    if (facing === "toward") { g.beginPath(); g.arc(cx, cy, rad * 0.35, 0, Math.PI * 2); g.fill(); }
    else { const q = rad * 0.7; g.beginPath(); g.moveTo(cx - q, cy - q); g.lineTo(cx + q, cy + q); g.moveTo(cx + q, cy - q); g.lineTo(cx - q, cy + q); g.stroke(); }
  }
  // Label beside the cell, on the side away from the arrow.
  const label = facing ? `${name} ${facing === "toward" ? "(faces you)" : "(faces away)"}` : name;
  const left = arrow ? arrow.dx > 0 : cx > L.px * 0.7;
  const above = arrow ? arrow.dy >= 0 : true;
  drawLabel(g, label, left ? r.x - 4 : r.x + r.w + 4, above ? r.y - 2 : r.y + r.h + 2, left ? "right" : "left", above ? "bottom" : "top", color);
}

type Projector = (x: number, y: number, z: number) => { sx: number; sy: number; visible: boolean };

function isoProjector(name: IsoViewName, L: OverlayLayout): Projector {
  // Same camera as Capture's isoTile (isoCamera with its default 35° fov, aspect 1).
  const { position, target } = isoCamera(name, L.box);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  cam.position.set(position.x, position.y, position.z);
  cam.lookAt(target.x, target.y, target.z);
  cam.updateMatrixWorld();
  const p = new THREE.Vector3();
  return (x, y, z) => {
    p.set(x, y, z).project(cam);
    return { sx: ((p.x + 1) / 2) * L.px, sy: ((1 - p.y) / 2) * L.px, visible: p.z < 1 };
  };
}

function drawIso(g: CanvasRenderingContext2D, project: Projector, name: string, a: Anchor, color: string): void {
  const c = project(a.x + 0.5, a.y + 0.5, a.z + 0.5);
  if (!c.visible) return;
  if (a.dir) {
    const d = dirVector(a.dir);
    const e = project(a.x + 0.5 + d.x * 2, a.y + 0.5 + d.y * 2, a.z + 0.5 + d.z * 2);
    drawArrow(g, c.sx, c.sy, e.sx, e.sy, color);
  }
  g.lineWidth = 2;
  g.strokeStyle = "#000";
  g.fillStyle = color;
  g.beginPath(); g.arc(c.sx, c.sy, 4, 0, Math.PI * 2); g.fill(); g.stroke();
  drawLabel(g, name, c.sx + 6, c.sy - 4, "left", "bottom", color);
}

function drawArrow(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const ang = Math.atan2(y1 - y0, x1 - x0), h = 7;
  const head = () => {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x1 - h * Math.cos(ang - 0.45), y1 - h * Math.sin(ang - 0.45));
    g.lineTo(x1 - h * Math.cos(ang + 0.45), y1 - h * Math.sin(ang + 0.45));
    g.closePath();
  };
  for (const [stroke, w] of [["#000", 4], [color, 2]] as const) {
    g.strokeStyle = stroke;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    head();
    if (stroke === "#000") g.stroke(); else { g.fillStyle = color; g.fill(); }
  }
}

function drawLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign, baseline: CanvasTextBaseline, color: string): void {
  g.textAlign = align;
  g.textBaseline = baseline;
  g.lineWidth = 3;
  g.strokeStyle = "#000";
  g.strokeText(text, x, y);
  g.fillStyle = color;
  g.fillText(text, x, y);
}
