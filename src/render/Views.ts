import type { Vec3 } from "../core/Raycast";
import type { Axis } from "../core/Tools";

/**
 * Named camera views for snapshots (pure math, no Three.js). Axis views are orthographic and named by
 * where the camera is: `front` looks from +Z toward -Z, `left` from -X, `top` from +Y (with -Z up, so
 * the picture is a map with the front at the bottom). `iso*` are perspective three-quarter views.
 */
export const AXIS_VIEWS = ["front", "back", "left", "right", "top", "bottom"] as const;
export const ISO_VIEWS = ["iso", "iso_left", "iso_back"] as const;
export type AxisViewName = (typeof AXIS_VIEWS)[number];
export type IsoViewName = (typeof ISO_VIEWS)[number];
export type ViewName = AxisViewName | IsoViewName;
export const VIEW_NAMES: readonly ViewName[] = [...AXIS_VIEWS, ...ISO_VIEWS];

export interface ScreenAxis {
  axis: Axis;
  sign: 1 | -1;
}

export interface AxisView {
  name: AxisViewName;
  /** Camera position side, e.g. "+Z". */
  from: string;
  forward: Vec3;
  up: Vec3;
  /** World axis (and direction) pointing right / up on screen. */
  right: ScreenAxis;
  screenUp: ScreenAxis;
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const AXIS_VIEW_DEFS: Record<AxisViewName, AxisView> = {
  front: { name: "front", from: "+Z", forward: v(0, 0, -1), up: v(0, 1, 0), right: { axis: "x", sign: 1 }, screenUp: { axis: "y", sign: 1 } },
  back: { name: "back", from: "-Z", forward: v(0, 0, 1), up: v(0, 1, 0), right: { axis: "x", sign: -1 }, screenUp: { axis: "y", sign: 1 } },
  left: { name: "left", from: "-X", forward: v(1, 0, 0), up: v(0, 1, 0), right: { axis: "z", sign: 1 }, screenUp: { axis: "y", sign: 1 } },
  right: { name: "right", from: "+X", forward: v(-1, 0, 0), up: v(0, 1, 0), right: { axis: "z", sign: -1 }, screenUp: { axis: "y", sign: 1 } },
  top: { name: "top", from: "+Y", forward: v(0, -1, 0), up: v(0, 0, -1), right: { axis: "x", sign: 1 }, screenUp: { axis: "z", sign: -1 } },
  bottom: { name: "bottom", from: "-Y", forward: v(0, 1, 0), up: v(0, 0, 1), right: { axis: "x", sign: 1 }, screenUp: { axis: "z", sign: 1 } },
};

/** Direction from the target toward the camera for perspective views. */
export const ISO_DIRS: Record<IsoViewName, Vec3> = {
  iso: v(1, 0.8, 1),
  iso_left: v(-1, 0.8, 1),
  iso_back: v(-1, 0.8, -1),
};

export const isAxisView = (n: string): n is AxisViewName => (AXIS_VIEWS as readonly string[]).includes(n);
export const isViewName = (n: string): n is ViewName => (VIEW_NAMES as readonly string[]).includes(n);

/** World-space box in cell-boundary units: [min, max) per axis. */
export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/** Square orthographic window for an axis view: center (in the two screen axes) + extent in cells. */
export interface OrthoFrame {
  view: AxisView;
  /** World coordinates of the window center along `view.right.axis` / `view.screenUp.axis`. */
  cu: number;
  cv: number;
  /** Width = height of the window in world units. */
  extent: number;
}

/**
 * Fits a square window around `box` (with a small margin) for an axis view. With `gridSize`, the window
 * is slid (not grown) to stay inside the grid where it fits, so no space is wasted below the floor.
 */
export function orthoFrame(view: AxisView, box: Box3, gridSize?: number, marginFrac = 0.06): OrthoFrame {
  const ua = view.right.axis, va = view.screenUp.axis;
  const w = box.max[ua] - box.min[ua], h = box.max[va] - box.min[va];
  const size = Math.max(w, h, 1);
  const extent = size + 2 * Math.max(1, Math.ceil(size * marginFrac));
  const fit = (c: number) => (gridSize === undefined || extent >= gridSize ? c : Math.min(Math.max(c, extent / 2), gridSize - extent / 2));
  return { view, cu: fit((box.min[ua] + box.max[ua]) / 2), cv: fit((box.min[va] + box.max[va]) / 2), extent };
}

/** Screen pixel (origin top-left) of a world coordinate pair for a frame rendered at `px` square. */
export function toScreen(f: OrthoFrame, px: number, u: number, w: number): { sx: number; sy: number } {
  const ppc = px / f.extent;
  return {
    sx: px / 2 + f.view.right.sign * (u - f.cu) * ppc,
    sy: px / 2 - f.view.screenUp.sign * (w - f.cv) * ppc,
  };
}

/** Smallest "nice" cell step whose labels are at least `minPx` apart. */
export function labelStep(pixelsPerCell: number, minPx = 22): number {
  for (const s of [1, 2, 4, 5, 8, 10, 16, 20, 32, 50, 64, 100, 128]) if (s * pixelsPerCell >= minPx) return s;
  return 256;
}

/** Camera placement for a perspective view so a box's bounding sphere fits a `fovDeg` frustum. */
export function isoCamera(name: IsoViewName, box: Box3, fovDeg = 35): { position: Vec3; target: Vec3 } {
  const c = v((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
  const r = Math.max(1, Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2);
  const d = ISO_DIRS[name], len = Math.hypot(d.x, d.y, d.z);
  const dist = (r / Math.sin(((fovDeg / 2) * Math.PI) / 180)) * 1.02;
  return { position: v(c.x + (d.x / len) * dist, c.y + (d.y / len) * dist, c.z + (d.z / len) * dist), target: c };
}
