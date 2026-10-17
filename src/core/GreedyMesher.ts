/**
 * Pure greedy mesher for export (glTF / OBJ / JSON) and for engines that consume Voxer models.
 *
 * Exposed faces only, per-vertex ambient occlusion baked into vertex colors, and greedy merging of
 * coplanar faces. Faces merge only when their final color AND all four corner AO values match, and only
 * along an axis where the AO is constant, so a merged quad interpolates to exactly the same colors as the
 * per-voxel quads it replaces (identical visuals, fewer triangles). Each quad is split along the diagonal
 * that keeps AO gradients from creasing. Matches the reference implementation in the Waldo game
 * (`voxel/src/voxels.js`) bit for bit in color and topology.
 *
 * Colors are **linear** RGB floats (what glTF `COLOR_0` and three.js vertex colors expect): palette hex
 * (sRGB) → linear, then multiplied by the AO / bottom-face factor. Use `linearToSrgb` for sRGB outputs.
 */
import { hexToRgb, normalizeHex } from "./Palette";

export type Pivot = "corner" | "base" | "center";

export interface MeshOptions {
  /** Origin: "corner" = cell (0,0,0) corner (Voxer world coords); "base" (default) = grid centre in x/z, y = 0; "center" = grid centre. */
  pivot?: Pivot;
  /** World units per voxel (default 1). */
  scale?: number;
  /** Bake ambient occlusion (and the darker bottom faces) into vertex colors (default true). */
  ao?: boolean;
  /** Greedily merge coplanar faces with identical color + AO (default true). */
  merge?: boolean;
  /** Hex → hex color substitutions applied to the palette (model variants). */
  remap?: Record<string, string>;
  /** Brightness factor for downward (-Y) faces (default 0.8 with AO, 1 without). */
  bottomShade?: number;
}

export interface MeshBBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MeshData {
  /** xyz per vertex. */
  positions: Float32Array;
  /** xyz unit normal per vertex (axis-aligned). */
  normals: Float32Array;
  /** Linear RGB per vertex, 0..1. */
  colors: Float32Array;
  /** Triangle list, CCW seen from outside. Uint16 when every index fits, else Uint32. */
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  triangleCount: number;
  /** Bounds of `positions` (all zero for an empty mesh). */
  bbox: MeshBBox;
}

/** The grid shape the mesher reads (`VoxelGrid` satisfies it): cells in `(y*S + z)*S + x` order, 0 = empty, n = palette[n-1]. */
export interface GridLike {
  size: number;
  data: Uint8Array;
}

/** AO brightness by number of open sides of a corner (0 = fully occluded … 3 = open). */
export const AO_LEVELS = [0.5, 0.68, 0.84, 1] as const;

// Per face direction: normal axis d, sign s, in-plane axes u, v. Corners (0,0),(1,0),(1,1),(0,1) in (u,v)
// are CCW around u×v; `flip` reverses winding where u×v points into the voxel.
const FACES = [
  { d: 0, s: 1, u: 2, v: 1, flip: true }, { d: 0, s: -1, u: 2, v: 1, flip: false },
  { d: 1, s: 1, u: 0, v: 2, flip: true }, { d: 1, s: -1, u: 0, v: 2, flip: false },
  { d: 2, s: 1, u: 0, v: 1, flip: false }, { d: 2, s: -1, u: 0, v: 1, flip: true },
] as const;
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]] as const;

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * AO level (0..3) of one face corner from its three neighbours in front of the face:
 * the two edge-adjacent cells and the diagonal one. Two solid sides fully occlude.
 */
export function aoLevel(side1: boolean, side2: boolean, corner: boolean): number {
  return side1 && side2 ? 0 : 3 - (+side1) - (+side2) - (+corner);
}

export function meshGrid(grid: GridLike, palette: readonly string[], opts: MeshOptions = {}): MeshData {
  const S = grid.size, cells = grid.data;
  const sc = opts.scale ?? 1, useAo = opts.ao ?? true, merge = opts.merge ?? true, pivot = opts.pivot ?? "base";
  if (!(sc > 0) || !Number.isFinite(sc)) throw new Error(`scale must be a positive number, got ${opts.scale}`);
  if (pivot !== "corner" && pivot !== "base" && pivot !== "center") throw new Error(`pivot must be "corner", "base" or "center"`);
  const bottomShade = opts.bottomShade ?? (useAo ? 0.8 : 1);

  // palette index → final color id; entries that remap to the same color share an id (and may merge)
  const remap = new Map<string, string>();
  for (const [from, to] of Object.entries(opts.remap ?? {})) {
    const f = normalizeHex(from), t = normalizeHex(to);
    if (!f || !t) throw new Error(`invalid remap ${from} → ${to}`);
    remap.set(f, t);
  }
  const uniq = new Map<string, number>(), lin: [number, number, number][] = [];
  const cid = palette.map((h) => {
    const n = normalizeHex(h) ?? "#ff00ff", hex = remap.get(n) ?? n;
    let k = uniq.get(hex);
    if (k === undefined) {
      const rgb = hexToRgb(hex)!;
      k = lin.length;
      lin.push([srgbToLinear(rgb.r / 255), srgbToLinear(rgb.g / 255), srgbToLinear(rgb.b / 255)]);
      uniq.set(hex, k);
    }
    return k;
  });
  const MISSING = lin.length; // cells whose palette slot doesn't exist render magenta
  lin.push([1, 0, 1]);
  const colorId = (v: number) => cid[v - 1] ?? MISSING;

  // occupied bounds: only scan those cells
  const lo = [S, S, S], hi = [-1, -1, -1];
  for (let y = 0, i = 0; y < S; y++)
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++, i++) {
        if (!cells[i]) continue;
        if (x < lo[0]!) lo[0] = x; if (x > hi[0]!) hi[0] = x;
        if (y < lo[1]!) lo[1] = y; if (y > hi[1]!) hi[1] = y;
        if (z < lo[2]!) lo[2] = z; if (z > hi[2]!) hi[2] = z;
      }

  const pos: number[] = [], nor: number[] = [], clr: number[] = [], ind: number[] = [];
  const origin = pivot === "corner" ? [0, 0, 0] : pivot === "base" ? [S / 2, 0, S / 2] : [S / 2, S / 2, S / 2];
  const at = (x: number, y: number, z: number) => (x < 0 || y < 0 || z < 0 || x >= S || y >= S || z >= S ? 0 : cells[(y * S + z) * S + x]!);
  const p = [0, 0, 0], q = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0], e = [0, 0, 0], ao = [0, 0, 0, 0];

  if (hi[0]! >= 0) {
    for (const f of FACES) {
      const shade = f.d === 1 && f.s < 0 ? bottomShade : 1;
      const n = [0, 0, 0];
      n[f.d] = f.s;
      const u0 = lo[f.u]!, nu = hi[f.u]! - u0 + 1, v0 = lo[f.v]!, nv = hi[f.v]! - v0 + 1;
      // mask[(v-v0)*nu + (u-u0)] = (colorId+1) << 8 | four 2-bit corner AO levels; 0 = no face
      const mask = new Int32Array(nu * nv);
      for (let w = lo[f.d]!; w <= hi[f.d]!; w++) {
        mask.fill(0);
        for (let j = 0; j < nv; j++)
          for (let i = 0; i < nu; i++) {
            q[f.d] = w; q[f.u] = u0 + i; q[f.v] = v0 + j;
            const c = cells[(q[1]! * S + q[2]!) * S + q[0]!]!;
            if (!c) continue;
            p[0] = q[0]!; p[1] = q[1]!; p[2] = q[2]!; p[f.d]! += f.s;
            if (at(p[0]!, p[1]!, p[2]!)) continue;
            let key = 0;
            for (let k = 0; k < 4; k++) {
              let level = 3;
              if (useAo) {
                const su = CORNERS[k]![0] ? 1 : -1, sv = CORNERS[k]![1] ? 1 : -1;
                for (let t = 0; t < 3; t++) a[t] = b[t] = e[t] = p[t]!;
                a[f.u]! += su; b[f.v]! += sv; e[f.u]! += su; e[f.v]! += sv;
                level = aoLevel(!!at(a[0]!, a[1]!, a[2]!), !!at(b[0]!, b[1]!, b[2]!), !!at(e[0]!, e[1]!, e[2]!));
              }
              key |= level << (2 * k);
            }
            mask[j * nu + i] = ((colorId(c) + 1) << 8) | key;
          }
        for (let j = 0; j < nv; j++)
          for (let i = 0; i < nu; i++) {
            const key = mask[j * nu + i]!;
            if (!key) continue;
            for (let k = 0; k < 4; k++) ao[k] = (key >> (2 * k)) & 3;
            let du = 1, dv = 1;
            if (merge) {
              // extend along u only where AO doesn't vary along u (and likewise for v)
              const canU = ao[0] === ao[1] && ao[3] === ao[2], canV = ao[0] === ao[3] && ao[1] === ao[2];
              if (canU) while (i + du < nu && mask[j * nu + i + du] === key) du++;
              if (canV)
                for (; j + dv < nv; dv++) {
                  let k = 0;
                  while (k < du && mask[(j + dv) * nu + i + k] === key) k++;
                  if (k < du) break;
                }
            }
            for (let r = 0; r < dv; r++) mask.fill(0, (j + r) * nu + i, (j + r) * nu + i + du);
            const col = lin[(key >> 8) - 1]!, base = pos.length / 3;
            for (let k = 0; k < 4; k++) {
              q[f.d] = w + (f.s > 0 ? 1 : 0);
              q[f.u] = u0 + i + CORNERS[k]![0] * du;
              q[f.v] = v0 + j + CORNERS[k]![1] * dv;
              pos.push((q[0]! - origin[0]!) * sc, (q[1]! - origin[1]!) * sc, (q[2]! - origin[2]!) * sc);
              nor.push(n[0]!, n[1]!, n[2]!);
              const m = AO_LEVELS[ao[k]! as 0 | 1 | 2 | 3] * shade;
              clr.push(col[0] * m, col[1] * m, col[2] * m);
            }
            // split along the brighter diagonal so AO gradients don't crease
            const tri = ao[0]! + ao[2]! < ao[1]! + ao[3]! ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
            for (let t = 0; t < 6; t += 3) {
              if (f.flip) ind.push(base + tri[t]!, base + tri[t + 2]!, base + tri[t + 1]!);
              else ind.push(base + tri[t]!, base + tri[t + 1]!, base + tri[t + 2]!);
            }
          }
      }
    }
  }

  const positions = Float32Array.from(pos);
  const bbox: MeshBBox = { min: [0, 0, 0], max: [0, 0, 0] };
  if (positions.length) {
    bbox.min = [Infinity, Infinity, Infinity];
    bbox.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      const v = positions[i]!, c = i % 3;
      if (v < bbox.min[c]!) bbox.min[c] = v;
      if (v > bbox.max[c]!) bbox.max[c] = v;
    }
  }
  const vertexCount = pos.length / 3;
  return {
    positions,
    normals: Float32Array.from(nor),
    colors: Float32Array.from(clr),
    indices: vertexCount <= 0xffff ? Uint16Array.from(ind) : Uint32Array.from(ind),
    vertexCount,
    triangleCount: ind.length / 3,
    bbox,
  };
}
