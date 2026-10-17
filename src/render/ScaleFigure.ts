import * as THREE from "three";
import type { Viewport } from "./Viewport";
import type { Box3 } from "./Views";

/**
 * Snapshot-only scale figure: a blocky person (legs, torso, head in contrasting pure colors) `height`
 * cells tall, standing on y=0 one cell off a corner of the content box, so it shows up beside the model
 * in every axis view. Preferred corner is front-left (-x, +z: never hides the model in the default `iso`
 * view); it flips to +x / -z when there's no room inside the grid there (snapshot framing keeps windows
 * inside the grid, which would crop a figure standing outside it). It is added to the Three scene only
 * while snapshot tiles render (`withFigure`); the voxel grid is untouched.
 */
export interface FigurePart {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  color: string;
}

export interface FigureSpec {
  height: number;
  /** Bounding box of the whole figure, world units (cells). */
  box: Box3;
  parts: FigurePart[];
}

export const DEFAULT_FIGURE_HEIGHT = 8;

/** Pure-channel colors: identical in flat (linear output) and lit snapshots, and loud against wood/stone. */
const LEGS = "#00ffff", TORSO = "#ff00ff", HEAD = "#ffff00";

/** Where the figure goes for content box `content` ([min, max) in cells) in a `gridSize`³ grid, and its parts. Pure. */
export function figureSpec(content: Box3, height = DEFAULT_FIGURE_HEIGHT, gridSize = Infinity): FigureSpec {
  const h = Math.max(1, Math.min(256, Number.isFinite(height) ? height : DEFAULT_FIGURE_HEIGHT));
  const w = Math.max(1, h * 0.3), d = Math.max(0.6, h * 0.18), head = Math.max(0.5, h * 0.2);
  const left = content.min.x - 1 - w, right = content.max.x + 1;
  const front = content.max.z + 1, back = content.min.z - 1 - d;
  const x0 = left >= 0 || right + w > gridSize ? left : right;
  const z0 = front + d <= gridSize || back < 0 ? front : back;
  const legsTop = h * 0.45, torsoTop = h - head;
  const hw = Math.min(w, head * 1.1);
  const part = (y0: number, y1: number, pw: number, pd: number, color: string): FigurePart => ({
    min: { x: x0 + (w - pw) / 2, y: y0, z: z0 + (d - pd) / 2 },
    max: { x: x0 + (w + pw) / 2, y: y1, z: z0 + (d + pd) / 2 },
    color,
  });
  return {
    height: h,
    box: { min: { x: x0, y: 0, z: z0 }, max: { x: x0 + w, y: h, z: z0 + d } },
    parts: [part(0, legsTop, w * 0.8, d * 0.9, LEGS), part(legsTop, torsoTop, w, d, TORSO), part(torsoTop, h, hw, Math.min(d, hw), HEAD)],
  };
}

/** Smallest box containing both. */
export function unionBox(a: Box3, b: Box3): Box3 {
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  };
}

function figureGroup(spec: FigureSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = "scale-figure";
  for (const p of spec.parts) {
    const sx = p.max.x - p.min.x, sy = p.max.y - p.min.y, sz = p.max.z - p.min.z;
    const color = new THREE.Color().setRGB(...hexRgb(p.color), THREE.LinearSRGBColorSpace);
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color }));
    m.position.set(p.min.x + sx / 2, p.min.y + sy / 2, p.min.z + sz / 2);
    g.add(m);
    // Dark outline so the parts read as separate blocks.
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x000000 }));
    edges.position.copy(m.position);
    g.add(edges);
  }
  return g;
}

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Runs `fn` with the figure in `view.scene` (no-op when `spec` is null), then removes and disposes it. */
export function withFigure<T>(view: Viewport, spec: FigureSpec | null, fn: () => T): T {
  if (!spec) return fn();
  const g = figureGroup(spec);
  view.scene.add(g);
  try {
    return fn();
  } finally {
    view.scene.remove(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    view.invalidate();
  }
}
