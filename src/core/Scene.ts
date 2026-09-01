import { normalizeHex } from "./Palette";
import type { VoxelGrid } from "./VoxelGrid";

/**
 * Scene file format — see `docs/FORMAT.md` for the versioning rules.
 *
 * Shape:
 *   { format: "voxer-scene", version: N, size, palette: string[], voxels: {encoding, runs} }
 *
 * Rules that keep old files loadable:
 *  - `version` is bumped **only** for a breaking change. Adding an optional field does not bump it.
 *  - Unknown top-level fields are kept in `extra` on decode and written back on encode, so a file
 *    saved by a newer build survives a round trip through an older one.
 *  - Voxel data is tagged with an `encoding`, so a new one can be added without a version bump;
 *    a decoder that does not know an encoding fails loudly instead of guessing.
 */
export const SCENE_FORMAT = "voxer-scene";
export const SCENE_VERSION = 1;

/** Voxel payload. `runs` is flat RLE: [count, value, count, value, …] over grid index order. */
export interface SceneVoxels {
  encoding: "rle-v1";
  runs: number[];
}

export interface SceneFile {
  format: typeof SCENE_FORMAT;
  version: number;
  size: number;
  palette: string[];
  voxels: SceneVoxels;
  /** Fields written by other (newer) builds, preserved verbatim. */
  [key: string]: unknown;
}

/** A decoded scene, ready to apply to an editor. */
export interface DecodedScene {
  size: number;
  palette: string[];
  cells: Uint8Array;
  /** Unrecognised top-level fields, so `encodeScene` can write them back. */
  extra: Record<string, unknown>;
}

/** Thrown for anything a user could plausibly hit: wrong file, newer version, corrupt data. */
export class SceneFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneFormatError";
  }
}

/**
 * Upgrades a document of version N to N+1. Add an entry when (and only when) `SCENE_VERSION` is
 * bumped; `decodeScene` then walks the chain, so a v1 file still opens in a v5 build.
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (doc) => ({ ...doc, version: 2, /* … */ }),
};

const KNOWN_KEYS = new Set(["format", "version", "size", "palette", "voxels"]);

/** Run-length encodes cell values in grid index order. */
export function encodeRuns(cells: Uint8Array): number[] {
  const runs: number[] = [];
  let i = 0;
  while (i < cells.length) {
    const v = cells[i]!;
    let n = 1;
    while (i + n < cells.length && cells[i + n] === v) n++;
    runs.push(n, v);
    i += n;
  }
  return runs;
}

/** Expands `runs` into exactly `length` cells; throws if the run lengths do not add up. */
export function decodeRuns(runs: readonly number[], length: number): Uint8Array {
  if (runs.length % 2 !== 0) throw new SceneFormatError("voxel runs must be [count, value] pairs");
  const cells = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const n = runs[i]!, v = runs[i + 1]!;
    if (!Number.isInteger(n) || n <= 0) throw new SceneFormatError(`bad run length ${n}`);
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new SceneFormatError(`bad cell value ${v}`);
    if (at + n > length) throw new SceneFormatError("voxel runs are longer than the grid");
    cells.fill(v, at, at + n);
    at += n;
  }
  if (at !== length) throw new SceneFormatError(`voxel runs cover ${at} of ${length} cells`);
  return cells;
}

/** Builds a scene document from a grid + palette. `extra` fields are written back as-is. */
export function encodeScene(
  grid: VoxelGrid,
  palette: readonly string[],
  extra: Record<string, unknown> = {},
): SceneFile {
  return {
    ...extra,
    format: SCENE_FORMAT,
    version: SCENE_VERSION,
    size: grid.size,
    palette: [...palette],
    voxels: { encoding: "rle-v1", runs: encodeRuns(grid.data) },
  };
}

function asRecord(input: unknown, what: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new SceneFormatError(`${what} must be an object`);
  return input as Record<string, unknown>;
}

/** Parses and validates a scene document, migrating older versions forward. */
export function decodeScene(input: unknown): DecodedScene {
  let doc = asRecord(input, "scene");
  if (doc["format"] !== SCENE_FORMAT) throw new SceneFormatError("not a Voxer scene file");

  const version = doc["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new SceneFormatError(`bad scene version ${String(version)}`);
  }
  if (version > SCENE_VERSION) {
    throw new SceneFormatError(`scene version ${version} was saved by a newer version of Voxer (this one reads up to ${SCENE_VERSION})`);
  }
  for (let v = version; v < SCENE_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new SceneFormatError(`no migration from scene version ${v}`);
    doc = migrate(doc);
  }

  const size = doc["size"];
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > 256) {
    throw new SceneFormatError(`bad grid size ${String(size)}`);
  }

  const rawPalette = doc["palette"];
  if (!Array.isArray(rawPalette) || rawPalette.length === 0) throw new SceneFormatError("palette must be a non-empty array");
  const palette = rawPalette.map((c) => {
    const hex = typeof c === "string" ? normalizeHex(c) : null;
    if (!hex) throw new SceneFormatError(`bad palette color ${JSON.stringify(c)}`);
    return hex;
  });

  const voxels = asRecord(doc["voxels"], "voxels");
  if (voxels["encoding"] !== "rle-v1") {
    throw new SceneFormatError(`unknown voxel encoding ${JSON.stringify(voxels["encoding"])}`);
  }
  const runs = voxels["runs"];
  if (!Array.isArray(runs)) throw new SceneFormatError("voxel runs must be an array");
  const cells = decodeRuns(runs as number[], size * size * size);

  for (const cell of cells) {
    if (cell > palette.length) throw new SceneFormatError(`cell references color ${cell} but the palette has ${palette.length}`);
  }

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!KNOWN_KEYS.has(k)) extra[k] = v;

  return { size, palette, cells, extra };
}
