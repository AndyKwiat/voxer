import { rgbToHex, type RGB } from "../core/Palette";

/** Options for `sampleImage`. Crop values are fractions (0..1) of the image. */
export interface SampleOptions {
  /** Output columns. Default 32. */
  cols?: number;
  /** Output rows; default keeps the crop's aspect ratio. */
  rows?: number;
  crop?: { x: number; y: number; w: number; h: number };
  /** Max distinct colors (k-means). Default 8, max 62. */
  maxColors?: number;
  /**
   * Cells to treat as empty: "auto" (default) = transparent pixels plus, if the four corners agree,
   * that background color; "none" = only transparent pixels; or a hex color to key out.
   */
  background?: "auto" | "none" | string;
  /** RGB distance (0..441) under which a cell counts as background. Default 40. */
  tolerance?: number;
}

export interface SampleResult {
  cols: number;
  rows: number;
  /** One string per row, top first; "." = empty. Feed straight into a `layer` op. */
  grid: string[];
  legend: Record<string, string>;
  counts: Record<string, number>;
  background: string | null;
}

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const dist = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

/**
 * Downsamples (area average) an image to a cols×rows character grid with a small quantized palette —
 * the bridge between a reference picture and `layer` ops (e.g. extrude a front silhouette).
 */
export function sampleImage(img: CanvasImageSource & { width: number; height: number }, opts: SampleOptions = {}): SampleResult {
  const crop = opts.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = crop.x * img.width, sy = crop.y * img.height, sw = crop.w * img.width, sh = crop.h * img.height;
  if (sw <= 0 || sh <= 0) throw new Error("sample: empty crop");
  const cols = Math.max(1, Math.min(256, Math.round(opts.cols ?? 32)));
  const rows = Math.max(1, Math.min(256, Math.round(opts.rows ?? (cols * sh) / sw)));
  const k = 6; // supersampling per cell
  const c = document.createElement("canvas");
  c.width = cols * k;
  c.height = rows * k;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const at = (x: number, y: number) => {
    const i = (y * c.width + x) * 4;
    return { r: px[i]!, g: px[i + 1]!, b: px[i + 2]!, a: px[i + 3]! };
  };

  const bgMode = opts.background ?? "auto";
  let bg: RGB | null = null;
  if (bgMode === "auto") {
    const corners = [at(0, 0), at(c.width - 1, 0), at(0, c.height - 1), at(c.width - 1, c.height - 1)].filter((p) => p.a > 128);
    if (corners.length === 4 && corners.every((p) => dist(p, corners[0]!) < 30)) bg = corners[0]!;
  } else if (bgMode !== "none") {
    const m = /^#?([0-9a-f]{6})$/i.exec(bgMode);
    if (!m) throw new Error(`sample: bad background "${bgMode}"`);
    const n = parseInt(m[1]!, 16);
    bg = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const tol = opts.tolerance ?? 40;

  // Area-average each cell over its opaque, non-background pixels; empty if they cover < half the cell.
  const cells: (RGB | null)[] = [];
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      let n = 0, R = 0, G = 0, B = 0;
      for (let y = r * k; y < (r + 1) * k; y++)
        for (let x = q * k; x < (q + 1) * k; x++) {
          const p = at(x, y);
          if (p.a < 128 || (bg && dist(p, bg) < tol)) continue;
          n++; R += p.r; G += p.g; B += p.b;
        }
      cells.push(n * 2 >= k * k ? { r: R / n, g: G / n, b: B / n } : null);
    }

  const centers = kmeans(cells.filter((x): x is RGB => !!x), Math.max(1, Math.min(62, opts.maxColors ?? 8)));
  const nearest = (p: RGB) => {
    let bi = 0, bd = Infinity;
    centers.forEach((cc, i) => { const d = dist(p, cc); if (d < bd) { bd = d; bi = i; } });
    return bi;
  };
  // Name colors by frequency so "a" is the dominant one.
  const freq = new Array(centers.length).fill(0) as number[];
  const assigned = cells.map((p) => (p ? nearest(p) : -1));
  for (const i of assigned) if (i >= 0) freq[i]!++;
  const order = centers.map((_, i) => i).filter((i) => freq[i]! > 0).sort((a, b) => freq[b]! - freq[a]!);
  const charOf = new Map(order.map((ci, n) => [ci, CHARS[n]!]));
  const legend: Record<string, string> = {}, counts: Record<string, number> = {};
  for (const ci of order) { legend[charOf.get(ci)!] = rgbToHex(centers[ci]!); counts[charOf.get(ci)!] = freq[ci]!; }

  const grid: string[] = [];
  for (let r = 0; r < rows; r++) {
    let s = "";
    for (let q = 0; q < cols; q++) { const a = assigned[r * cols + q]!; s += a < 0 ? "." : charOf.get(a)!; }
    grid.push(s);
  }
  return { cols, rows, grid, legend, counts, background: bg ? rgbToHex(bg) : null };
}

/** Plain k-means with farthest-point init (deterministic). */
export function kmeans(points: RGB[], k: number, iters = 12): RGB[] {
  if (!points.length) return [];
  const centers: RGB[] = [{ ...points[0]! }];
  while (centers.length < k) {
    let best: RGB | null = null, bd = 0;
    for (const p of points) {
      const d = Math.min(...centers.map((c) => dist(p, c)));
      if (d > bd) { bd = d; best = p; }
    }
    if (!best || bd < 8) break; // fewer distinct colors than k
    centers.push({ ...best });
  }
  for (let it = 0; it < iters; it++) {
    const sum = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const p of points) {
      let bi = 0, bd = Infinity;
      centers.forEach((c, i) => { const d = dist(p, c); if (d < bd) { bd = d; bi = i; } });
      const s = sum[bi]!;
      s.r += p.r; s.g += p.g; s.b += p.b; s.n++;
    }
    sum.forEach((s, i) => { if (s.n) centers[i] = { r: s.r / s.n, g: s.g / s.n, b: s.b / s.n }; });
  }
  return centers;
}

/**
 * The current reference image: set by paste / drag-drop in the page, or by the agent (via the server).
 * Shown as a thumbnail in the sidebar; persisted on the server at `/api/reference` when available.
 */
export class ReferenceImage {
  image: HTMLImageElement | null = null;
  private panel: HTMLElement;
  private thumb = document.createElement("img");

  constructor(container: HTMLElement, private upload = true) {
    this.panel = container;
    this.thumb.alt = "reference";
    const clear = document.createElement("button");
    clear.textContent = "×";
    clear.title = "Clear reference";
    clear.onclick = () => { void this.clear(); };
    const label = document.createElement("div");
    label.className = "ref-label";
    label.textContent = "Reference — paste or drop an image";
    container.append(label, this.thumb, clear);
    this.render();

    window.addEventListener("paste", (e) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); void this.setBlob(file, true); }
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) { e.preventDefault(); void this.setBlob(file, true); }
    });
  }

  /** Loads the server's current reference (if any). */
  async refresh(): Promise<void> {
    if (!this.upload) return;
    try {
      const r = await fetch("/api/reference", { cache: "no-store" });
      if (r.ok) await this.setBlob(await r.blob(), false);
      else if (r.status === 404) this.set(null);
    } catch { /* no server */ }
  }

  async setBlob(blob: Blob, persist: boolean): Promise<void> {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    this.set(img);
    if (persist && this.upload) {
      await fetch("/api/reference", { method: "PUT", headers: { "content-type": blob.type || "image/png" }, body: blob }).catch(() => {});
    }
  }

  async clear(): Promise<void> {
    this.set(null);
    if (this.upload) await fetch("/api/reference", { method: "DELETE" }).catch(() => {});
  }

  private set(img: HTMLImageElement | null): void {
    this.image = img;
    this.render();
  }

  private render(): void {
    this.panel.classList.toggle("has-image", !!this.image);
    if (this.image) this.thumb.src = this.image.src;
    else this.thumb.removeAttribute("src");
  }
}
