import * as THREE from "three";
import type { VoxelGrid } from "../core/VoxelGrid";
import { EMPTY } from "../core/VoxelGrid";
import { Palette, hexToRgb } from "../core/Palette";

export const CHUNK = 16;

// face: normal + 4 corners (CCW when viewed from outside)
const FACES: { n: [number, number, number]; c: [number, number, number][] }[] = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/** Builds exposed-face geometry for one chunk. Returns null if the chunk is empty. */
export function buildChunkGeometry(grid: VoxelGrid, palette: Palette, cx: number, cy: number, cz: number): THREE.BufferGeometry | null {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
  const x1 = Math.min(x0 + CHUNK, grid.size), y1 = Math.min(y0 + CHUNK, grid.size), z1 = Math.min(z0 + CHUNK, grid.size);
  const colorCache = new Map<number, [number, number, number]>();
  const colorOf = (v: number) => {
    let c = colorCache.get(v);
    if (!c) {
      const rgb = hexToRgb(palette.get(Palette.fromCell(v)) ?? "") ?? { r: 255, g: 0, b: 255 };
      c = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
      colorCache.set(v, c);
    }
    return c;
  };
  for (let y = y0; y < y1; y++)
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const v = grid.get(x, y, z);
        if (v === EMPTY) continue;
        const rgb = colorOf(v);
        for (const f of FACES) {
          if (grid.has(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
          const base = pos.length / 3;
          for (const c of f.c) {
            pos.push(x + c[0], y + c[1], z + c[2]);
            nrm.push(f.n[0], f.n[1], f.n[2]);
            col.push(rgb[0], rgb[1], rgb[2]);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

const chunkKey = (cx: number, cy: number, cz: number) => (cx << 16) | (cy << 8) | cz;
const chunkOf = (n: number) => Math.floor(n / CHUNK);

/** Keeps one mesh per chunk, rebuilt lazily when marked dirty. */
export class ChunkedVoxelMesh {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private dirty = new Set<number>();
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });

  constructor(private grid: VoxelGrid, private palette: Palette) {}

  get dirtyCount(): number {
    return this.dirty.size;
  }

  /** Marks the chunk containing (x,y,z) dirty, plus in-bounds neighbours when on a chunk border. */
  markVoxel(x: number, y: number, z: number): void {
    const s = this.grid.size;
    const cx = chunkOf(x), cy = chunkOf(y), cz = chunkOf(z);
    this.dirty.add(chunkKey(cx, cy, cz));
    const edge = (n: number, add: (d: number) => void) => {
      if (n % CHUNK === 0 && n > 0) add(-1);
      if (n % CHUNK === CHUNK - 1 && n < s - 1) add(1);
    };
    edge(x, (d) => this.dirty.add(chunkKey(cx + d, cy, cz)));
    edge(y, (d) => this.dirty.add(chunkKey(cx, cy + d, cz)));
    edge(z, (d) => this.dirty.add(chunkKey(cx, cy, cz + d)));
  }

  /** Marks every chunk that has content (e.g. after a palette color changes). */
  markAll(): void {
    for (const k of this.meshes.keys()) this.dirty.add(k);
  }

  update(): void {
    for (const k of this.dirty) {
      const cx = k >> 16, cy = (k >> 8) & 255, cz = k & 255;
      const old = this.meshes.get(k);
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
        this.meshes.delete(k);
      }
      const geo = buildChunkGeometry(this.grid, this.palette, cx, cy, cz);
      if (geo) {
        const m = new THREE.Mesh(geo, this.material);
        m.frustumCulled = true;
        this.group.add(m);
        this.meshes.set(k, m);
      }
    }
    this.dirty.clear();
  }
}
