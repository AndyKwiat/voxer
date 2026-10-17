import type { Anchors } from "./Anchors";
import type { Slots } from "./Slots";

/**
 * Serialized scene (save/load, agent sync). `data` is the grid's cells in `VoxelGrid.index` order,
 * run-length encoded as (value byte, varint run length) pairs, then base64.
 *
 * Version 2 adds optional `slots` (named palette shade ramps, `core/Slots.ts`) and `anchors` (named
 * cells, `core/Anchors.ts`). Scenes without either are still written as version 1, so older builds
 * keep reading them; both versions load.
 */
export interface SceneData {
  version: SceneVersion;
  size: number;
  palette: string[];
  data: string;
  slots?: Slots;
  anchors?: Anchors;
}

export type SceneVersion = 1 | 2;
export const SCENE_VERSIONS: readonly number[] = [1, 2];

export function encodeCells(cells: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < cells.length; ) {
    const v = cells[i]!;
    let n = 1;
    while (i + n < cells.length && cells[i + n] === v) n++;
    out.push(v);
    for (let m = n; ; ) {
      if (m < 0x80) { out.push(m); break; }
      out.push((m & 0x7f) | 0x80);
      m >>>= 7;
    }
    i += n;
  }
  return toBase64(Uint8Array.from(out));
}

export function decodeCells(data: string, length: number): Uint8Array {
  const src = fromBase64(data), cells = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < src.length; ) {
    const v = src[i++]!;
    let n = 0, shift = 0;
    for (;;) {
      const b = src[i++];
      if (b === undefined) throw new Error("scene data truncated");
      n |= (b & 0x7f) << shift;
      if (b < 0x80) break;
      shift += 7;
    }
    if (o + n > length) throw new Error("scene data longer than grid");
    cells.fill(v, o, o + n);
    o += n;
  }
  if (o !== length) throw new Error(`scene data has ${o} cells, expected ${length}`);
  return cells;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
