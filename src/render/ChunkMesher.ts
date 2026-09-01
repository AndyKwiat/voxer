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

type Face = (typeof FACES)[number];

/** Calls `fn` for every face of a filled cell in the chunk that is not covered by a neighbour. */
function eachExposedFace(
  grid: VoxelGrid,
  cx: number, cy: number, cz: number,
  fn: (x: number, y: number, z: number, v: number, f: Face) => void,
): void {
  const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
  const x1 = Math.min(x0 + CHUNK, grid.size), y1 = Math.min(y0 + CHUNK, grid.size), z1 = Math.min(z0 + CHUNK, grid.size);
  for (let y = y0; y < y1; y++)
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++) {
        const v = grid.get(x, y, z);
        if (v === EMPTY) continue;
        for (const f of FACES) {
          if (grid.has(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
          fn(x, y, z, v, f);
        }
      }
}

/** Builds exposed-face geometry for one chunk. Returns null if the chunk is empty. */
export function buildChunkGeometry(grid: VoxelGrid, palette: Palette, cx: number, cy: number, cz: number): THREE.BufferGeometry | null {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
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
  eachExposedFace(grid, cx, cy, cz, (x, y, z, v, f) => {
    const rgb = colorOf(v);
    const base = pos.length / 3;
    for (const c of f.c) {
      pos.push(x + c[0], y + c[1], z + c[2]);
      nrm.push(f.n[0], f.n[1], f.n[2]);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

/** Packs an integer corner (0..256 per axis) into one number, for de-duplicating shared edges. */
const cornerKey = (x: number, y: number, z: number) => (x * 257 + y) * 257 + z;

/**
 * Outline geometry for one chunk: the four borders of every exposed face, so each visible voxel
 * gets a thin box around it. Shared edges between neighbouring faces are emitted once.
 * Returns null if the chunk has nothing visible.
 */
export function buildChunkEdgeGeometry(grid: VoxelGrid, cx: number, cy: number, cz: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const seen = new Set<number>();
  eachExposedFace(grid, cx, cy, cz, (x, y, z, _v, f) => {
    for (let i = 0; i < 4; i++) {
      const a = f.c[i]!, b = f.c[(i + 1) % 4]!;
      const ax = x + a[0], ay = y + a[1], az = z + a[2];
      const bx = x + b[0], by = y + b[1], bz = z + b[2];
      const ka = cornerKey(ax, ay, az), kb = cornerKey(bx, by, bz);
      const key = ka < kb ? ka * 17_000_000 + kb : kb * 17_000_000 + ka;
      if (seen.has(key)) continue;
      seen.add(key);
      pos.push(ax, ay, az, bx, by, bz);
    }
  });
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

const chunkKey = (cx: number, cy: number, cz: number) => (cx << 16) | (cy << 8) | cz;
const chunkOf = (n: number) => Math.floor(n / CHUNK);

/** Keeps one mesh per chunk, rebuilt lazily when marked dirty. */
export class ChunkedVoxelMesh {
  readonly group = new THREE.Group();
  /** Voxel outlines; empty until `setEdges(true)`. Lives in its own group so it can be toggled. */
  readonly edgeGroup = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh>();
  private edges = new Map<number, THREE.LineSegments>();
  private dirty = new Set<number>();
  private showEdges = false;
  // polygonOffset pushes the filled faces back a hair so the outlines do not z-fight with them.
  private material = new THREE.MeshLambertMaterial({
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  private edgeMaterial = new THREE.LineBasicMaterial({ color: 0x101010 });

  constructor(private grid: VoxelGrid, private palette: Palette) {}

  get dirtyCount(): number {
    return this.dirty.size;
  }

  get edgesVisible(): boolean {
    return this.showEdges;
  }

  /** Turns voxel outlines on or off. Geometry is only built while they are on. */
  setEdges(on: boolean): void {
    if (on === this.showEdges) return;
    this.showEdges = on;
    if (on) this.markAll();
    else this.clearEdges();
  }

  private clearEdges(): void {
    for (const l of this.edges.values()) {
      this.edgeGroup.remove(l);
      l.geometry.dispose();
    }
    this.edges.clear();
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
      const oldEdges = this.edges.get(k);
      if (oldEdges) {
        this.edgeGroup.remove(oldEdges);
        oldEdges.geometry.dispose();
        this.edges.delete(k);
      }
      const geo = buildChunkGeometry(this.grid, this.palette, cx, cy, cz);
      if (geo) {
        const m = new THREE.Mesh(geo, this.material);
        m.frustumCulled = true;
        this.group.add(m);
        this.meshes.set(k, m);
      }
      if (this.showEdges) {
        const eg = buildChunkEdgeGeometry(this.grid, cx, cy, cz);
        if (eg) {
          const l = new THREE.LineSegments(eg, this.edgeMaterial);
          this.edgeGroup.add(l);
          this.edges.set(k, l);
        }
      }
    }
    this.dirty.clear();
  }
}
