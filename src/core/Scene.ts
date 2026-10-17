/**
 * Serialized scene (save/load, agent sync). `data` is the grid's cells in `VoxelGrid.index` order,
 * run-length encoded as (value byte, varint run length) pairs, then base64.
 */
export interface SceneData {
  version: 1;
  size: number;
  palette: string[];
  data: string;
}

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
