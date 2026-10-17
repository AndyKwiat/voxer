export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const DEFAULT_COLORS: readonly string[] = [
  "#ffffff", "#c0c0c0", "#808080", "#404040", "#000000", "#7f3f00", "#ff0000", "#ff7f00",
  "#ffff00", "#7fff00", "#00ff00", "#00ff7f", "#00ffff", "#007fff", "#0000ff", "#7f00ff",
  "#ff00ff", "#ff007f", "#ffbfbf", "#ffdfbf", "#ffffbf", "#dfffbf", "#bfffbf", "#bfffdf",
  "#bfffff", "#bfdfff", "#bfbfff", "#dfbfff", "#ffbfff", "#ffbfdf", "#8b5a2b", "#e0c090",
];

export function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHex(rgb) : null;
}

export const MAX_COLORS = 255;

export class Palette {
  private colors: string[];
  readonly onChange = new Set<() => void>();

  constructor(initial: readonly string[] = DEFAULT_COLORS) {
    this.colors = [];
    for (const c of initial) this.add(c);
  }

  get length(): number {
    return this.colors.length;
  }

  get(i: number): string | undefined {
    return this.colors[i];
  }

  all(): readonly string[] {
    return this.colors;
  }

  /** Appends a color; returns its index. */
  add(hex: string): number {
    const n = normalizeHex(hex);
    if (!n) throw new Error(`invalid color ${hex}`);
    if (this.colors.length >= MAX_COLORS) throw new Error("palette full");
    this.colors.push(n);
    this.emit();
    return this.colors.length - 1;
  }

  update(i: number, hex: string): void {
    const n = normalizeHex(hex);
    if (!n) throw new Error(`invalid color ${hex}`);
    if (i < 0 || i >= this.colors.length) throw new RangeError(`no color at ${i}`);
    this.colors[i] = n;
    this.emit();
  }

  /** Replaces every color (e.g. loading a scene). Needs 1..MAX_COLORS valid colors. */
  replaceAll(hexes: readonly string[]): void {
    if (!hexes.length || hexes.length > MAX_COLORS) throw new Error(`palette needs 1..${MAX_COLORS} colors`);
    const next = hexes.map((h) => {
      const n = normalizeHex(h);
      if (!n) throw new Error(`invalid color ${h}`);
      return n;
    });
    this.colors = next;
    this.emit();
  }

  /** Index of an exact color, or -1. */
  indexOf(hex: string): number {
    const n = normalizeHex(hex);
    return n ? this.colors.indexOf(n) : -1;
  }

  /** Index of the perceptually-ish nearest color (weighted RGB distance). */
  nearest(hex: string): number {
    const t = hexToRgb(hex);
    if (!t) throw new Error(`invalid color ${hex}`);
    let best = 0, bestD = Infinity;
    this.colors.forEach((c, i) => {
      const o = hexToRgb(c)!;
      const d = 2 * (o.r - t.r) ** 2 + 4 * (o.g - t.g) ** 2 + 3 * (o.b - t.b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /**
   * Palette index for a color given as an index or hex: existing exact match, else appended,
   * else (palette full) the nearest existing color.
   */
  resolve(c: number | string): number {
    if (typeof c === "number") {
      if (!Number.isInteger(c) || c < 0 || c >= this.colors.length) throw new RangeError(`no color at index ${c}`);
      return c;
    }
    const i = this.indexOf(c);
    if (i >= 0) return i;
    if (!normalizeHex(c)) throw new Error(`invalid color "${c}" (use "#rrggbb" or a palette index)`);
    return this.colors.length < MAX_COLORS ? this.add(c) : this.nearest(c);
  }

  /** Grid cell value for a palette index (cells store index + 1; 0 is empty). */
  static toCell(i: number): number {
    return i + 1;
  }

  static fromCell(v: number): number {
    return v - 1;
  }

  private emit() {
    for (const f of this.onChange) f();
  }
}
