import { hexToRgb } from "./Palette";
import type { Vec3 } from "./Raycast";
import { EMPTY, type VoxelGrid } from "./VoxelGrid";

/**
 * Pure model checks for agents (`api.lint` / MCP `lint`): connected pieces, specks, floating parts,
 * enclosed air, content on the grid boundary, mirror symmetry and palette hygiene. Works on the content
 * bounding box with typed arrays, so it stays fast on 256³ grids. Each check can be switched off.
 */

export interface LintOptions {
  /** Connected components, specks and floating parts (default true). */
  components?: boolean;
  /** Enclosed air pockets (default true). */
  pockets?: boolean;
  /** Content touching the grid faces (default true). */
  boundary?: boolean;
  /** Mirror symmetry across x and z (default true). */
  symmetry?: boolean;
  /** Unused / near-duplicate palette colors (default true). */
  palette?: boolean;
  /** Components smaller than this are specks (default 4). */
  speckSize?: number;
  /** Floor height for floating checks (default 0). */
  floorY?: number;
  /** RGB distance (0..441) under which two used colors are near-duplicates (default 20). */
  nearColor?: number;
  /** Max entries per list in the result (default 20). */
  maxList?: number;
}

export interface Box { min: Vec3; max: Vec3 }

export interface Component {
  size: number;
  bbox: Box;
  /** is the main body, touches the floor, or rests (diagonally, from above) on a grounded component */
  grounded: boolean;
}

export interface LintResult {
  size: number;
  count: number;
  bbox: Box | null;
  components?: {
    count: number;
    /** the largest component reaches the floor (floorY) */
    mainOnFloor: boolean;
    /** largest (main body) first, at most maxList */
    list: Component[];
    specks: { size: number; cells: Vec3[] }[];
    speckCount: number;
    floating: Component[];
    floatingCount: number;
  };
  pockets?: { cells: number; pockets: number; bbox: Box | null };
  boundary?: {
    touching: boolean;
    /** voxels on each grid face; "-y" is the floor (normal) and isn't a clipping warning */
    faces: Record<"-x" | "+x" | "-y" | "+y" | "-z" | "+z", number>;
  };
  symmetry?: {
    /** pivot uses the `mirror` op convention: cell c ↔ pivot - c (bbox min + max) */
    x: { pivot: number; shape: number; color: number };
    z: { pivot: number; shape: number; color: number };
  };
  palette?: {
    used: number;
    unused: number[];
    nearDuplicates: { a: number; b: number; hexA: string; hexB: string; distance: number }[];
  };
  warnings: string[];
  summary: string;
  ms: number;
}

const fmtBox = (b: Box) => `${b.min.x},${b.min.y},${b.min.z}..${b.max.x},${b.max.y},${b.max.z}`;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Runs the checks. `palette` is the hex list (palette index i ↔ cell value i+1). */
export function lint(grid: VoxelGrid, palette: readonly string[] = [], opts: LintOptions = {}): LintResult {
  const t0 = performance.now();
  const s = grid.size, data = grid.data;
  const maxList = opts.maxList ?? 20;
  const warnings: string[] = [];
  const res: LintResult = { size: s, count: 0, bbox: null, warnings, summary: "", ms: 0 };

  // bbox + count + color histogram in one pass
  let x0 = s, y0 = s, z0 = s, x1 = -1, y1 = -1, z1 = -1, count = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (v === EMPTY) continue;
    count++;
    hist[v]!++;
    const x = i % s, z = Math.floor(i / s) % s, y = Math.floor(i / (s * s));
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  res.count = count;
  if (count) res.bbox = { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };

  // Local copy of the content bbox padded by one empty cell on every side, so neighbour steps
  // (±1, ±PW, ±PL) never need bounds checks. p = (y-y0+1)*PL + (z-z0+1)*PW + (x-x0+1).
  const gi = (x: number, y: number, z: number) => y * s * s + z * s + x;
  const W = x1 - x0 + 1, H = y1 - y0 + 1, D = z1 - z0 + 1;
  const PW = W + 2, PD = D + 2, PL = PW * PD, N = count ? PL * (H + 2) : 0;
  const pi = (x: number, y: number, z: number) => (y - y0 + 1) * PL + (z - z0 + 1) * PW + (x - x0 + 1);
  const xOf = (p: number) => (p % PW) - 1 + x0, zOf = (p: number) => (Math.floor(p / PW) % PD) - 1 + z0, yOf = (p: number) => Math.floor(p / PL) - 1 + y0;
  const occ = new Uint8Array(N);
  for (let y = y0; y <= y1 && count; y++)
    for (let z = z0; z <= z1; z++) {
      const g = gi(x0, y, z);
      occ.set(data.subarray(g, g + W), pi(x0, y, z));
    }
  const NB = [1, -1, PW, -PW, PL, -PL] as const;
  const grow = (b: Box, p: number) => {
    const x = xOf(p), y = yOf(p), z = zOf(p);
    if (x < b.min.x) b.min.x = x; if (x > b.max.x) b.max.x = x;
    if (y < b.min.y) b.min.y = y; if (y > b.max.y) b.max.y = y;
    if (z < b.min.z) b.min.z = z; if (z > b.max.z) b.max.z = z;
  };
  const cellBox = (p: number): Box => ({ min: { x: xOf(p), y: yOf(p), z: zOf(p) }, max: { x: xOf(p), y: yOf(p), z: zOf(p) } });

  if (count && opts.components !== false) res.components = components();
  if (count && opts.pockets !== false) res.pockets = pockets();
  if (opts.boundary !== false) res.boundary = boundary();
  if (count && opts.symmetry !== false) res.symmetry = { x: symmetry("x"), z: symmetry("z") };
  if (opts.palette !== false) res.palette = paletteCheck();

  res.summary = summarize(res);
  res.ms = Math.round(performance.now() - t0);
  return res;

  function components(): NonNullable<LintResult["components"]> {
    const label = new Int32Array(N); // 0 = empty / unvisited, k = component k (1-based)
    const queue = new Int32Array(count);
    const comps: Component[] = [];
    for (let p = 0; p < N; p++) {
      if (!occ[p] || label[p]) continue;
      const id = comps.length + 1;
      const c: Component = { size: 0, bbox: cellBox(p), grounded: false };
      let head = 0, tail = 0;
      queue[tail++] = p;
      label[p] = id;
      while (head < tail) {
        const q = queue[head++]!;
        grow(c.bbox, q);
        for (let k = 0; k < 6; k++) {
          const m = q + NB[k]!;
          if (occ[m] && !label[m]) { label[m] = id; queue[tail++] = m; }
        }
      }
      c.size = tail;
      comps.push(c);
    }

    // Support: a piece is grounded if it touches the floor, is the main (largest) body, or has a cell
    // diagonally above a grounded piece's cell (face contact would have merged them). Propagated to a fixpoint.
    const floorY = opts.floorY ?? 0;
    let main = comps[0]!;
    for (const c of comps) if (c.size > main.size) main = c;
    const mainOnFloor = main.bbox.min.y <= floorY;
    for (const c of comps) c.grounded = c === main || c.bbox.min.y <= floorY;
    if (comps.length > 1) {
      const rests = comps.map(() => new Set<number>()); // rests[a] = components a sits on
      const below = [-1, 1, -PW, PW, -PW - 1, -PW + 1, PW - 1, PW + 1].map((o) => o - PL);
      for (let p = PL; p < N; p++) {
        const a = label[p]!;
        if (!a) continue;
        for (const o of below) {
          const b = label[p + o]!;
          if (b && b !== a) rests[a - 1]!.add(b - 1);
        }
      }
      for (let changed = true; changed;) {
        changed = false;
        comps.forEach((c, k) => {
          if (c.grounded) return;
          for (const b of rests[k]!) if (comps[b]!.grounded) { c.grounded = true; changed = true; return; }
        });
      }
    }

    const speckSize = opts.speckSize ?? 4;
    const sorted = [...comps].sort((a, b) => (b === main ? 1 : a === main ? -1 : b.size - a.size));
    // a speck is a small piece that isn't the model's main body
    const speckList = sorted.slice(1).filter((c) => c.size < speckSize);
    const specks = speckList.slice(0, maxList).map((c) => {
      const cells: Vec3[] = [];
      const id = comps.indexOf(c) + 1;
      const b = c.bbox;
      for (let y = b.min.y; y <= b.max.y; y++) for (let z = b.min.z; z <= b.max.z; z++) for (let x = b.min.x; x <= b.max.x; x++)
        if (label[pi(x, y, z)] === id) cells.push({ x, y, z });
      return { size: c.size, cells };
    });
    const floating = sorted.filter((c) => !c.grounded);
    return {
      count: comps.length,
      mainOnFloor,
      list: sorted.slice(0, maxList),
      specks,
      speckCount: speckList.length,
      floating: floating.slice(0, maxList),
      floatingCount: floating.length,
    };
  }

  function pockets(): NonNullable<LintResult["pockets"]> {
    // Flood empty cells from the padding layer (outside the bbox); empty cells it never reaches are enclosed.
    // Steps that leave a padded row wrap into another padding cell, which is outside too, so only 0..N is checked.
    const seen = new Uint8Array(N);
    const queue = new Int32Array(N - count);
    let tail = 0;
    const flood = (start: number) => {
      let head = start;
      while (head < tail) {
        const q = queue[head++]!;
        for (let k = 0; k < 6; k++) {
          const m = q + NB[k]!;
          if (m >= 0 && m < N && !seen[m] && !occ[m]) { seen[m] = 1; queue[tail++] = m; }
        }
      }
    };
    seen[0] = 1;
    queue[tail++] = 0;
    flood(0);
    let cells = 0, nPockets = 0, bbox: Box | null = null;
    for (let p = 0; p < N; p++) {
      if (seen[p] || occ[p]) continue;
      nPockets++;
      const start = tail;
      seen[p] = 1;
      queue[tail++] = p;
      flood(start);
      cells += tail - start;
      bbox ??= cellBox(p);
      for (let k = start; k < tail; k++) grow(bbox, queue[k]!);
    }
    return { cells, pockets: nPockets, bbox };
  }

  function boundary(): NonNullable<LintResult["boundary"]> {
    const faces = { "-x": 0, "+x": 0, "-y": 0, "+y": 0, "-z": 0, "+z": 0 };
    if (count) {
      const m = s - 1;
      // only scan faces the bbox reaches
      const face = (key: keyof typeof faces, cell: (a: number, b: number) => number) => {
        let n = 0;
        for (let a = 0; a < s; a++) for (let b = 0; b < s; b++) if (data[cell(a, b)] !== EMPTY) n++;
        faces[key] = n;
      };
      if (x0 === 0) face("-x", (a, b) => gi(0, a, b));
      if (x1 === m) face("+x", (a, b) => gi(m, a, b));
      if (y0 === 0) face("-y", (a, b) => gi(a, 0, b));
      if (y1 === m) face("+y", (a, b) => gi(a, m, b));
      if (z0 === 0) face("-z", (a, b) => gi(a, b, 0));
      if (z1 === m) face("+z", (a, b) => gi(a, b, m));
    }
    const touching = faces["-x"] + faces["+x"] + faces["+y"] + faces["-z"] + faces["+z"] > 0;
    return { touching, faces };
  }

  function symmetry(axis: "x" | "z") {
    // c ↔ pivot - c with pivot = min + max: the content's own center plane
    const pivot = axis === "x" ? x0 + x1 : z0 + z1;
    let shape = 0, color = 0;
    for (let p = 0; p < N; p++) {
      const v = occ[p]!;
      if (!v) continue;
      const w = axis === "x" ? occ[p + (pivot - 2 * xOf(p))]! : occ[p + (pivot - 2 * zOf(p)) * PW]!;
      if (w) { shape++; if (w === v) color++; }
    }
    return { pivot, shape: round3(shape / count), color: round3(color / count) };
  }

  function paletteCheck(): NonNullable<LintResult["palette"]> {
    const unused: number[] = [], usedIdx: number[] = [];
    palette.forEach((_, i) => (hist[i + 1] ? usedIdx : unused).push(i));
    const near: NonNullable<LintResult["palette"]>["nearDuplicates"] = [];
    const limit = opts.nearColor ?? 20;
    for (let i = 0; i < usedIdx.length; i++)
      for (let j = i + 1; j < usedIdx.length; j++) {
        const a = usedIdx[i]!, b = usedIdx[j]!;
        const p = hexToRgb(palette[a]!), q = hexToRgb(palette[b]!);
        if (!p || !q) continue;
        const d = Math.hypot(p.r - q.r, p.g - q.g, p.b - q.b);
        if (d <= limit) near.push({ a, b, hexA: palette[a]!, hexB: palette[b]!, distance: Math.round(d * 10) / 10 });
      }
    near.sort((p, q) => p.distance - q.distance);
    return { used: usedIdx.length, unused, nearDuplicates: near.slice(0, maxList) };
  }

  function summarize(r: LintResult): string {
    if (!r.count) return "empty scene";
    const c = r.components;
    if (c) {
      if (c.speckCount) warnings.push(`${c.speckCount} speck${c.speckCount > 1 ? "s" : ""} (< ${opts.speckSize ?? 4} voxels): ` +
        c.specks.slice(0, 5).map((p) => `${p.size} at ${p.cells[0]!.x},${p.cells[0]!.y},${p.cells[0]!.z}`).join("; ") + (c.speckCount > 5 ? "; …" : ""));
      const main = c.list[0]!;
      if (!c.mainOnFloor) warnings.push(`main body (${main.size} voxels) does not reach the floor y=${opts.floorY ?? 0} (min y ${main.bbox.min.y})`);
      const nf = c.floatingCount;
      if (nf > 0) warnings.push(`${nf} floating piece${nf > 1 ? "s" : ""}: ` + c.floating.slice(0, 5).map((f) => `${f.size} at ${fmtBox(f.bbox)}`).join("; ") + (nf > 5 ? "; …" : ""));
    }
    const b = r.boundary;
    if (b?.touching) {
      const faces = (Object.entries(b.faces) as [string, number][]).filter(([k, n]) => n && k !== "-y").map(([k, n]) => `${k} ${n}`);
      warnings.push(`content touches the grid boundary (${faces.join(", ")} voxels) — may be clipped`);
    }
    const pal = r.palette;
    if (pal?.nearDuplicates.length) warnings.push(`near-duplicate colors: ` + pal.nearDuplicates.slice(0, 5).map((d) => `${d.a} ${d.hexA} ~ ${d.b} ${d.hexB}`).join("; "));

    const parts = [`${r.count} voxels in ${fmtBox(r.bbox!)}`];
    if (c) parts.push(`${c.count} component${c.count > 1 ? "s" : ""}`);
    if (r.pockets) parts.push(r.pockets.cells ? `${r.pockets.cells} enclosed air cells in ${r.pockets.pockets} pocket${r.pockets.pockets > 1 ? "s" : ""}` : "no enclosed air");
    if (r.symmetry) parts.push(`symmetry x ${r.symmetry.x.color} (pivot ${r.symmetry.x.pivot}), z ${r.symmetry.z.color} (pivot ${r.symmetry.z.pivot})`);
    if (pal) parts.push(`${pal.used} colors used, ${pal.unused.length} unused`);
    return [...warnings.map((w) => `WARNING: ${w}`), parts.join("; ")].join("\n");
  }
}
