export const GRID_SIZE = 32;
export const EMPTY = 0;

export interface Voxel {
  x: number;
  y: number;
  z: number;
}

/** Palette index stored in each cell: 0 = empty, 1..255 = palette slot + 1. */
export class VoxelGrid {
  readonly size: number;
  readonly data: Uint8Array;
  private _count = 0;

  constructor(size = GRID_SIZE) {
    if (size <= 0 || size > 256) throw new Error("size must be 1..256");
    this.size = size;
    this.data = new Uint8Array(size * size * size);
  }

  get count(): number {
    return this._count;
  }

  inBounds(x: number, y: number, z: number): boolean {
    const s = this.size;
    return x >= 0 && y >= 0 && z >= 0 && x < s && y < s && z < s;
  }

  index(x: number, y: number, z: number): number {
    return (y * this.size + z) * this.size + x;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return EMPTY;
    return this.data[this.index(x, y, z)]!;
  }

  has(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) !== EMPTY;
  }

  /** Sets a cell; returns the previous value. Throws if out of bounds. */
  set(x: number, y: number, z: number, value: number): number {
    if (!this.inBounds(x, y, z)) throw new RangeError(`out of bounds: ${x},${y},${z}`);
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(`bad value ${value}`);
    const i = this.index(x, y, z);
    const prev = this.data[i]!;
    if (prev === EMPTY && value !== EMPTY) this._count++;
    else if (prev !== EMPTY && value === EMPTY) this._count--;
    this.data[i] = value;
    return prev;
  }

  erase(x: number, y: number, z: number): number {
    return this.set(x, y, z, EMPTY);
  }

  *occupied(): IterableIterator<Voxel & { value: number }> {
    const s = this.size;
    for (let y = 0; y < s; y++)
      for (let z = 0; z < s; z++)
        for (let x = 0; x < s; x++) {
          const v = this.data[(y * s + z) * s + x]!;
          if (v !== EMPTY) yield { x, y, z, value: v };
        }
  }
}
