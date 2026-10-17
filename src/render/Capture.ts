import * as THREE from "three";
import { boundingBox } from "../core/Commands";
import type { Editor } from "../core/Editor";
import type { Viewport } from "./Viewport";
import {
  AXIS_VIEW_DEFS, isAxisView, isoCamera, labelStep, orthoFrame, toScreen,
  type AxisView, type Box3, type IsoViewName, type ViewName,
} from "./Views";

export interface SnapshotOptions {
  /** Tiles to render, in order. Default: front, left, top, iso. */
  views?: ViewName[];
  /** Pixel size of each square tile's picture. Default 360. */
  tile?: number;
  /** Frame the content's bounding box (default) or the whole grid. */
  frame?: "content" | "grid";
  /** Append the reference image as an extra tile. */
  reference?: CanvasImageSource & { width: number; height: number } | null;
  /** Axis views: "flat" (default) shows exact palette colors; "lit" uses scene lighting. Iso views are always lit. */
  shading?: "flat" | "lit";
  /** Columns in the sheet. Default: 2 for up to 4 tiles, else 3. */
  columns?: number;
}

export const DEFAULT_VIEWS: ViewName[] = ["front", "left", "top", "iso"];

const TITLE_H = 22, GUTTER_L = 30, GUTTER_B = 20, PAD = 6;
const BG = "#000", PANEL = "#0d0d0d", MINOR = "#1e1e1e", MAJOR = "#3a3a3a", TEXT = "#bbb";

/**
 * Renders a labeled contact sheet of views as one canvas. Orthographic axis views get a cell grid
 * behind the model and coordinate rulers (labels are cell coordinates), so cells can be counted and
 * compared against a reference. Perspective `iso*` views show the scene grid.
 */
export function snapshotSheet(view: Viewport, editor: Editor, opts: SnapshotOptions = {}): HTMLCanvasElement {
  const views = opts.views?.length ? opts.views : DEFAULT_VIEWS;
  const px = Math.max(96, Math.min(1024, Math.round(opts.tile ?? 360)));
  const s = editor.grid.size;
  const bb = boundingBox(editor.grid);
  const gridBox: Box3 = { min: { x: 0, y: 0, z: 0 }, max: { x: s, y: s, z: s } };
  const box: Box3 = opts.frame === "grid" || !bb ? gridBox
    : { min: bb.min, max: { x: bb.max.x + 1, y: bb.max.y + 1, z: bb.max.z + 1 } };

  const tiles: HTMLCanvasElement[] = views.map((name) => (isAxisView(name) ? axisTile(view, AXIS_VIEW_DEFS[name], box, s, px, opts.shading !== "lit") : isoTile(view, name, box, px)));
  if (opts.reference) tiles.push(referenceTile(opts.reference, px));

  const cols = opts.columns ?? (tiles.length <= 4 ? Math.min(2, tiles.length) : 3);
  const rows = Math.ceil(tiles.length / cols);
  const tw = tiles[0]!.width, th = tiles[0]!.height;
  const sheet = document.createElement("canvas");
  sheet.width = cols * tw + (cols + 1) * PAD;
  sheet.height = rows * th + (rows + 1) * PAD;
  const g = sheet.getContext("2d")!;
  g.fillStyle = "#222";
  g.fillRect(0, 0, sheet.width, sheet.height);
  tiles.forEach((t, i) => g.drawImage(t, PAD + (i % cols) * (tw + PAD), PAD + Math.floor(i / cols) * (th + PAD)));
  return sheet;
}

function newTile(px: number, title: string): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = GUTTER_L + px + PAD;
  c.height = TITLE_H + px + GUTTER_B;
  const g = c.getContext("2d")!;
  g.fillStyle = PANEL;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = TEXT;
  g.font = "bold 12px ui-monospace, Menlo, monospace";
  g.textBaseline = "middle";
  g.fillText(title, 6, TITLE_H / 2);
  return { c, g };
}

const sgn = (a: { axis: string; sign: number }) => `${a.sign > 0 ? "+" : "-"}${a.axis}`;

function axisTile(view: Viewport, v: AxisView, box: Box3, gridSize: number, px: number, flat: boolean): HTMLCanvasElement {
  const f = orthoFrame(v, box, gridSize);
  const half = f.extent / 2;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, gridSize * 4 + 200);
  // Center of the window in world space, pushed out along -forward beyond the grid.
  const center = new THREE.Vector3(gridSize / 2, gridSize / 2, gridSize / 2);
  center[v.right.axis] = f.cu;
  center[v.screenUp.axis] = f.cv;
  const fwd = new THREE.Vector3(v.forward.x, v.forward.y, v.forward.z);
  cam.position.copy(center).addScaledVector(fwd, -(gridSize * 2 + 50));
  cam.up.set(v.up.x, v.up.y, v.up.z);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  const picture = view.renderOffscreen(cam, px, { grid: false, transparent: true, flat });

  const { c, g } = newTile(px, `${v.name.toUpperCase()} (from ${v.from})  →${sgn(v.right)} ↑${sgn(v.screenUp)}`);
  const ox = GUTTER_L, oy = TITLE_H;
  g.fillStyle = BG;
  g.fillRect(ox, oy, px, px);
  const ppc = px / f.extent, step = labelStep(ppc);
  const range = (center: number) => [Math.floor(center - half) - 1, Math.ceil(center + half) + 1] as const;
  const [u0, u1] = range(f.cu), [w0, w1] = range(f.cv);
  g.save();
  g.beginPath();
  g.rect(ox, oy, px, px);
  g.clip();
  g.lineWidth = 1;
  // Cell boundary lines; brighter on multiples of the label step. Only inside the grid's extent.
  for (let u = Math.max(0, u0); u <= Math.min(gridSize, u1); u++) {
    if (ppc < 5 && u % step) continue;
    const { sx } = toScreen(f, px, u, 0);
    g.strokeStyle = u % step === 0 ? MAJOR : MINOR;
    g.beginPath();
    const a = toScreen(f, px, 0, Math.max(0, w0)).sy, b = toScreen(f, px, 0, Math.min(gridSize, w1)).sy;
    g.moveTo(ox + Math.round(sx) + 0.5, oy + a);
    g.lineTo(ox + Math.round(sx) + 0.5, oy + b);
    g.stroke();
  }
  for (let w = Math.max(0, w0); w <= Math.min(gridSize, w1); w++) {
    if (ppc < 5 && w % step) continue;
    const { sy } = toScreen(f, px, 0, w);
    g.strokeStyle = w % step === 0 ? MAJOR : MINOR;
    g.beginPath();
    const a = toScreen(f, px, Math.max(0, u0), 0).sx, b = toScreen(f, px, Math.min(gridSize, u1), 0).sx;
    g.moveTo(ox + a, oy + Math.round(sy) + 0.5);
    g.lineTo(ox + b, oy + Math.round(sy) + 0.5);
    g.stroke();
  }
  g.drawImage(picture, ox, oy);
  g.restore();

  // Rulers: cell coordinates at cell centers, every `step` cells.
  g.fillStyle = TEXT;
  g.font = "10px ui-monospace, Menlo, monospace";
  g.textAlign = "center";
  g.textBaseline = "top";
  for (let u = Math.max(0, u0); u <= Math.min(gridSize - 1, u1); u++) {
    if (u % step) continue;
    const sx = toScreen(f, px, u + 0.5, 0).sx;
    if (sx < 0 || sx > px) continue;
    g.fillText(String(u), ox + sx, oy + px + 4);
  }
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (let w = Math.max(0, w0); w <= Math.min(gridSize - 1, w1); w++) {
    if (w % step) continue;
    const sy = toScreen(f, px, 0, w + 0.5).sy;
    if (sy < 0 || sy > px) continue;
    g.fillText(String(w), ox - 4, oy + sy);
  }
  return c;
}

function isoTile(view: Viewport, name: IsoViewName, box: Box3, px: number): HTMLCanvasElement {
  const fov = 35;
  const { position, target } = isoCamera(name, box, fov);
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 5000);
  cam.position.set(position.x, position.y, position.z);
  cam.lookAt(target.x, target.y, target.z);
  cam.updateMatrixWorld();
  // The scene grid walls sit at x=0 / z=0, so they're only a backdrop for the default iso direction.
  const picture = view.renderOffscreen(cam, px, { grid: name === "iso" && view.gridVisible, transparent: false });
  const { c, g } = newTile(px, `${name.toUpperCase()} (perspective, from ${dirLabel(name)})`);
  g.drawImage(picture, GUTTER_L, TITLE_H);
  return c;
}

const dirLabel = (n: IsoViewName) => ({ iso: "+x+y+z", iso_left: "-x+y+z", iso_back: "-x+y-z" })[n];

function referenceTile(img: CanvasImageSource & { width: number; height: number }, px: number): HTMLCanvasElement {
  const { c, g } = newTile(px, "REFERENCE");
  g.fillStyle = "#000";
  g.fillRect(GUTTER_L, TITLE_H, px, px);
  const k = Math.min(px / img.width, px / img.height);
  const w = img.width * k, h = img.height * k;
  g.drawImage(img, GUTTER_L + (px - w) / 2, TITLE_H + (px - h) / 2, w, h);
  return c;
}

/** Canvas → base64 PNG without the data-URL prefix. */
export function canvasToBase64(c: HTMLCanvasElement, type: "image/png" | "image/jpeg" = "image/png"): string {
  return c.toDataURL(type, 0.9).split(",")[1]!;
}
