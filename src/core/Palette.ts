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

  /** Replaces every color at once (scene load); emits a single change. */
  setAll(colors: readonly string[]): void {
    if (colors.length === 0) throw new Error("palette must have at least one color");
    if (colors.length > MAX_COLORS) throw new Error("palette full");
    const next = colors.map((c) => {
      const n = normalizeHex(c);
      if (!n) throw new Error(`invalid color ${c}`);
      return n;
    });
    this.colors = next;
    this.emit();
  }

  update(i: number, hex: string): void {
    const n = normalizeHex(hex);
    if (!n) throw new Error(`invalid color ${hex}`);
    if (i < 0 || i >= this.colors.length) throw new RangeError(`no color at ${i}`);
    this.colors[i] = n;
    this.emit();
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
