/**
 * Mesh file writers (pure, hand-written — no exporter dependency):
 *  - `toGLB`  glTF 2.0 binary: one mesh, POSITION / NORMAL / COLOR_0 (linear float RGB) + indices, one
 *             PBR material (white base color, so COLOR_0 is the surface color; loaders enable vertex colors).
 *  - `toOBJ`  Wavefront OBJ with the common `v x y z r g b` vertex-color extension (sRGB, as Blender,
 *             MeshLab and three's OBJLoader read it) + `vn` normals and `f v//vn` faces.
 *  - `toMeshJSON`  compact JSON: base64 little-endian typed arrays for engines that build geometry directly.
 *  - `exportMesh`  grid + palette + options → file bytes + stats.
 */
import { linearToSrgb, meshGrid, type GridLike, type MeshBBox, type MeshData, type MeshOptions } from "./GreedyMesher";

export type MeshFormat = "glb" | "obj" | "json";
export const MESH_FORMATS: readonly MeshFormat[] = ["glb", "obj", "json"];

export interface MeshStats {
  vertices: number;
  triangles: number;
  bbox: MeshBBox;
}

export interface ExportOptions extends MeshOptions {
  format?: MeshFormat;
  /** Mesh / node name inside the file (default "voxer"). */
  name?: string;
  /** JSON only: vertex color space (default "linear"; OBJ is always sRGB, GLB always linear). */
  colorSpace?: "linear" | "srgb";
}

export interface ExportResult {
  format: MeshFormat;
  mime: string;
  extension: string;
  bytes: Uint8Array;
  stats: MeshStats;
}

export const MESH_MIME: Record<MeshFormat, string> = { glb: "model/gltf-binary", obj: "model/obj", json: "application/json" };

const GL_FLOAT = 5126, GL_UNSIGNED_SHORT = 5123, GL_UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963, TRIANGLES = 4;
const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;

export function meshStats(m: MeshData): MeshStats {
  return { vertices: m.vertexCount, triangles: m.triangleCount, bbox: m.bbox };
}

const pad4 = (n: number) => (n + 3) & ~3;

/** glTF 2.0 binary. An empty mesh gives a valid file with an empty scene. */
export function toGLB(m: MeshData, name = "voxer"): Uint8Array {
  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "Voxer GreedyMesher" },
    scene: 0,
    scenes: [{ name, nodes: m.triangleCount ? [0] : [] }],
  };
  const parts: Uint8Array[] = [];
  let binLength = 0;
  if (m.triangleCount) {
    const views: object[] = [];
    const add = (arr: ArrayBufferView, target: number) => {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      views.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength, target });
      parts.push(bytes);
      const padded = pad4(bytes.byteLength);
      if (padded > bytes.byteLength) parts.push(new Uint8Array(padded - bytes.byteLength));
      binLength += padded;
      return views.length - 1;
    };
    const n = m.vertexCount;
    const idx32 = m.indices instanceof Uint32Array;
    gltf.bufferViews = views;
    gltf.accessors = [
      { bufferView: add(m.positions, ARRAY_BUFFER), componentType: GL_FLOAT, count: n, type: "VEC3", min: m.bbox.min, max: m.bbox.max },
      { bufferView: add(m.normals, ARRAY_BUFFER), componentType: GL_FLOAT, count: n, type: "VEC3" },
      { bufferView: add(m.colors, ARRAY_BUFFER), componentType: GL_FLOAT, count: n, type: "VEC3" },
      { bufferView: add(m.indices, ELEMENT_ARRAY_BUFFER), componentType: idx32 ? GL_UNSIGNED_INT : GL_UNSIGNED_SHORT, count: m.indices.length, type: "SCALAR" },
    ];
    gltf.buffers = [{ byteLength: binLength }];
    gltf.materials = [{ name: "vertex_colors", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }];
    gltf.meshes = [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0, mode: TRIANGLES }] }];
    gltf.nodes = [{ name, mesh: 0 }];
  }
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = pad4(json.byteLength);
  const total = 12 + 8 + jsonLen + (binLength ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  out.set(json, 20);
  out.fill(0x20, 20 + json.byteLength, 20 + jsonLen); // JSON chunk pads with spaces
  if (binLength) {
    let o = 20 + jsonLen;
    dv.setUint32(o, binLength, true);
    dv.setUint32(o + 4, CHUNK_BIN, true);
    o += 8;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
  }
  return out;
}

const fmt = (v: number) => {
  const s = (Math.round(v * 1e6) / 1e6).toString();
  return s === "-0" ? "0" : s;
};

/** Wavefront OBJ; vertex colors are sRGB (the de-facto convention for `v x y z r g b`). */
export function toOBJ(m: MeshData, name = "voxer"): string {
  const lines: string[] = [`# Voxer export: ${m.vertexCount} vertices, ${m.triangleCount} triangles`, `o ${name}`];
  const { positions: p, colors: c, normals: n } = m;
  for (let i = 0; i < m.vertexCount; i++) {
    const k = i * 3;
    lines.push(`v ${fmt(p[k]!)} ${fmt(p[k + 1]!)} ${fmt(p[k + 2]!)} ${fmt(linearToSrgb(c[k]!))} ${fmt(linearToSrgb(c[k + 1]!))} ${fmt(linearToSrgb(c[k + 2]!))}`);
  }
  for (let i = 0; i < m.vertexCount; i++) {
    const k = i * 3;
    lines.push(`vn ${fmt(n[k]!)} ${fmt(n[k + 1]!)} ${fmt(n[k + 2]!)}`);
  }
  const ix = m.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! + 1, b = ix[t + 1]! + 1, d = ix[t + 2]! + 1;
    lines.push(`f ${a}//${a} ${b}//${b} ${d}//${d}`);
  }
  return lines.join("\n") + "\n";
}

export interface MeshJSON {
  format: "voxer-mesh";
  version: 1;
  colorSpace: "linear" | "srgb";
  vertexCount: number;
  triangleCount: number;
  bbox: MeshBBox;
  /** base64 of little-endian Float32Array (xyz). */
  positions: string;
  /** base64 of little-endian Float32Array (xyz). */
  normals: string;
  /** base64 of little-endian Float32Array (rgb, 0..1). */
  colors: string;
  indexType: "uint16" | "uint32";
  /** base64 of little-endian Uint16Array / Uint32Array. */
  indices: string;
}

export function toMeshJSON(m: MeshData, colorSpace: "linear" | "srgb" = "linear"): MeshJSON {
  const colors = colorSpace === "srgb" ? m.colors.map(linearToSrgb) : m.colors;
  return {
    format: "voxer-mesh", version: 1, colorSpace,
    vertexCount: m.vertexCount, triangleCount: m.triangleCount, bbox: m.bbox,
    positions: bytesToBase64(m.positions), normals: bytesToBase64(m.normals), colors: bytesToBase64(colors),
    indexType: m.indices instanceof Uint32Array ? "uint32" : "uint16", indices: bytesToBase64(m.indices),
  };
}

export function exportMesh(grid: GridLike, palette: readonly string[], opts: ExportOptions = {}): ExportResult {
  const format = opts.format ?? "glb";
  if (!MESH_FORMATS.includes(format)) throw new Error(`format must be one of ${MESH_FORMATS.join(", ")}`);
  const m = meshGrid(grid, palette, opts);
  const name = opts.name ?? "voxer";
  const bytes = format === "glb" ? toGLB(m, name)
    : format === "obj" ? new TextEncoder().encode(toOBJ(m, name))
    : new TextEncoder().encode(JSON.stringify(toMeshJSON(m, opts.colorSpace)));
  return { format, mime: MESH_MIME[format], extension: format === "json" ? "mesh.json" : format, bytes, stats: meshStats(m) };
}

/** base64 of a typed array's bytes (host byte order; little-endian on every target we run on). */
export function bytesToBase64(arr: ArrayBufferView): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
