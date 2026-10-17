import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { meshGrid } from "../src/core/GreedyMesher";
import { decodeCells } from "../src/core/Scene";
import { base64ToBytes, exportMesh, toGLB, toMeshJSON, toOBJ } from "../src/core/MeshExport";
import { VoxelGrid } from "../src/core/VoxelGrid";

const PALETTE = ["#ff0000", "#3366cc", "#ffffff"];
function sample(): VoxelGrid {
  const g = new VoxelGrid(8);
  for (let x = 0; x < 5; x++) for (let z = 0; z < 3; z++) g.set(x, 0, z, 2);
  g.set(1, 1, 1, 1);
  g.set(2, 1, 1, 3);
  g.set(2, 2, 1, 3);
  return g;
}

interface Gltf {
  asset: { version: string };
  buffers: { byteLength: number }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: unknown[];
}

function parseGLB(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(dv.getUint32(0, true)).toBe(0x46546c67); // "glTF"
  expect(dv.getUint32(4, true)).toBe(2);
  expect(dv.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLen = dv.getUint32(12, true);
  expect(dv.getUint32(16, true)).toBe(0x4e4f534a); // "JSON"
  expect(jsonLen % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as Gltf;
  const binHeader = 20 + jsonLen;
  const binLen = dv.getUint32(binHeader, true);
  expect(dv.getUint32(binHeader + 4, true)).toBe(0x004e4942); // "BIN\0"
  expect(binLen % 4).toBe(0);
  expect(binHeader + 8 + binLen).toBe(bytes.byteLength);
  return { json, bin: bytes.subarray(binHeader + 8, binHeader + 8 + binLen), binLen };
}

const COMPONENT_SIZE: Record<number, number> = { 5126: 4, 5123: 2, 5125: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC3: 3 };

describe("toGLB", () => {
  test("is structurally valid glTF 2.0 with in-bounds views/accessors and correct POSITION min/max", () => {
    const m = meshGrid(sample(), PALETTE);
    const { json, bin, binLen } = parseGLB(toGLB(m));
    expect(json.asset.version).toBe("2.0");
    expect(json.buffers[0]!.byteLength).toBe(binLen);
    for (const v of json.bufferViews) {
      expect((v.byteOffset ?? 0) % 4).toBe(0);
      expect((v.byteOffset ?? 0) + v.byteLength).toBeLessThanOrEqual(binLen);
    }
    for (const a of json.accessors) {
      const v = json.bufferViews[a.bufferView]!;
      const size = COMPONENT_SIZE[a.componentType]! * TYPE_SIZE[a.type]!;
      expect((a.byteOffset ?? 0) + a.count * size).toBeLessThanOrEqual(v.byteLength);
    }
    const prim = json.meshes[0]!.primitives[0]!;
    expect(Object.keys(prim.attributes).sort()).toEqual(["COLOR_0", "NORMAL", "POSITION"]);
    expect(json.materials.length).toBe(1);
    const pa = json.accessors[prim.attributes.POSITION!]!;
    const pv = json.bufferViews[pa.bufferView]!;
    const pos = new Float32Array(bin.slice(pv.byteOffset ?? 0, (pv.byteOffset ?? 0) + pa.count * 12).buffer);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    pos.forEach((v, i) => { min[i % 3] = Math.min(min[i % 3]!, v); max[i % 3] = Math.max(max[i % 3]!, v); });
    expect(pa.min).toEqual(min);
    expect(pa.max).toEqual(max);
    expect(pa.min).toEqual([-4, 0, -4]); // base pivot on an 8³ grid
    expect(pa.max).toEqual([1, 3, -1]);
    const ia = json.accessors[prim.indices]!;
    expect(ia.count).toBe(m.triangleCount * 3);
    expect(ia.componentType).toBe(5123);
  });

  test("an empty mesh is still a valid GLB (no BIN chunk, empty scene)", () => {
    const bytes = toGLB(meshGrid(new VoxelGrid(4), PALETTE));
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint32(8, true)).toBe(bytes.byteLength);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + dv.getUint32(12, true))));
    expect(json.scenes[0].nodes).toEqual([]);
    expect(json.meshes).toBeUndefined();
  });

  test("loads with three's GLTFLoader", async () => {
    const m = meshGrid(sample(), PALETTE);
    const glb = toGLB(m, "sample");
    const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    const gltf = await new GLTFLoader().parseAsync(ab, "");
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(1);
    const geo = meshes[0]!.geometry;
    expect(geo.getAttribute("position").count).toBe(m.vertexCount);
    expect(geo.getIndex()!.count).toBe(m.triangleCount * 3);
    expect(Array.from(geo.getAttribute("color").array as Float32Array)).toEqual(Array.from(m.colors));
    expect((meshes[0]!.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    geo.computeBoundingBox();
    expect(geo.boundingBox!.min.toArray()).toEqual(m.bbox.min);
    expect(geo.boundingBox!.max.toArray()).toEqual(m.bbox.max);
  });
});

describe("toOBJ", () => {
  test("one v (with sRGB color) and vn per vertex, one f per triangle", () => {
    const m = meshGrid(sample(), PALETTE);
    const lines = toOBJ(m).trim().split("\n");
    const count = (p: string) => lines.filter((l) => l.startsWith(p)).length;
    expect(count("v ")).toBe(m.vertexCount);
    expect(count("vn ")).toBe(m.vertexCount);
    expect(count("f ")).toBe(m.triangleCount);
    for (const l of lines.filter((l) => l.startsWith("v "))) expect(l.split(" ").length).toBe(7);
    const faces = lines.filter((l) => l.startsWith("f ")).flatMap((l) => l.slice(2).split(" ").map((t) => Number(t.split("//")[0])));
    expect(Math.min(...faces)).toBe(1);
    expect(Math.max(...faces)).toBe(m.vertexCount);
    // the top of the lone red voxel is unoccluded: exact palette red in sRGB
    expect(lines).toContain("v -3 2 -3 1 0 0");
  });
});

describe("toMeshJSON / exportMesh", () => {
  test("round-trips typed arrays through base64", () => {
    const m = meshGrid(sample(), PALETTE);
    const j = toMeshJSON(m);
    expect(j.colorSpace).toBe("linear");
    expect(new Float32Array(base64ToBytes(j.positions).buffer)).toEqual(m.positions);
    expect(new Float32Array(base64ToBytes(j.colors).buffer)).toEqual(m.colors);
    expect(new Uint16Array(base64ToBytes(j.indices).buffer)).toEqual(m.indices as Uint16Array);
    const s = toMeshJSON(m, "srgb");
    expect(new Float32Array(base64ToBytes(s.colors).buffer)[0]).toBeGreaterThan(m.colors[0]! - 1e-6);
  });

  test("exportMesh picks the format and reports stats", () => {
    const g = sample();
    const glb = exportMesh(g, PALETTE, { format: "glb", merge: false });
    const merged = exportMesh(g, PALETTE, { format: "glb" });
    expect(glb.mime).toBe("model/gltf-binary");
    expect(merged.stats.triangles).toBeLessThan(glb.stats.triangles);
    expect(new TextDecoder().decode(exportMesh(g, PALETTE, { format: "obj" }).bytes)).toStartWith("# Voxer export");
    expect(JSON.parse(new TextDecoder().decode(exportMesh(g, PALETTE, { format: "json" }).bytes)).format).toBe("voxer-mesh");
    expect(() => exportMesh(g, PALETTE, { format: "fbx" as never })).toThrow();
  });

  test("real Voxer model (when available): merged < unmerged, same bbox", () => {
    let scene: { size: number; palette: string[]; data: string } | null = null;
    try { scene = JSON.parse(readFileSync(new URL("../models/pagoda.json", import.meta.url), "utf8")); } catch { return; }
    const g = new VoxelGrid(scene!.size);
    g.setAll(decodeCells(scene!.data, scene!.size ** 3));
    const a = meshGrid(g, scene!.palette, { merge: false }), b = meshGrid(g, scene!.palette);
    expect(b.triangleCount).toBeLessThan(a.triangleCount);
    expect(b.bbox).toEqual(a.bbox);
  });
});
