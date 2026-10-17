import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SceneData } from "../src/core/Scene";

const NAME = /^[\w.-]{1,64}$/;
const IMAGE_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

export function validSceneName(n: string): boolean {
  return NAME.test(n) && !n.startsWith(".") && !n.startsWith("_");
}

/**
 * Scenes, the reference image and the autosave. With a directory (the real server: `models/`) they
 * are files — `<name>.json`, `_reference.<ext>`, `_autosave.json`; without one (tests, browser-check)
 * they live in memory only.
 */
export class Store {
  private mem = new Map<string, SceneData>();
  private ref: { bytes: Uint8Array; type: string } | null = null;

  constructor(readonly dir?: string) {
    if (dir) mkdirSync(dir, { recursive: true });
  }

  async listScenes(): Promise<string[]> {
    if (!this.dir) return [...this.mem.keys()].sort();
    return readdirSync(this.dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => f.slice(0, -5)).sort();
  }

  async getScene(name: string): Promise<SceneData | null> {
    if (!this.dir) return this.mem.get(name) ?? null;
    const f = Bun.file(join(this.dir, `${name}.json`));
    return (await f.exists()) ? ((await f.json()) as SceneData) : null;
  }

  async putScene(name: string, scene: SceneData): Promise<void> {
    if (!this.dir) { this.mem.set(name, scene); return; }
    await Bun.write(join(this.dir, `${name}.json`), JSON.stringify(scene));
  }

  async getAutosave(): Promise<SceneData | null> {
    if (!this.dir) return null;
    const f = Bun.file(join(this.dir, "_autosave.json"));
    return (await f.exists()) ? ((await f.json().catch(() => null)) as SceneData | null) : null;
  }

  async putAutosave(scene: SceneData): Promise<void> {
    if (this.dir) await Bun.write(join(this.dir, "_autosave.json"), JSON.stringify(scene));
  }

  async getReference(): Promise<{ bytes: Uint8Array; type: string } | null> {
    if (this.ref || !this.dir) return this.ref;
    for (const [type, ext] of Object.entries(IMAGE_EXT)) {
      const f = Bun.file(join(this.dir, `_reference.${ext}`));
      if (await f.exists()) return (this.ref = { bytes: new Uint8Array(await f.arrayBuffer()), type });
    }
    return null;
  }

  async putReference(bytes: Uint8Array, type: string): Promise<void> {
    const ext = IMAGE_EXT[type];
    if (!ext) throw new Error(`unsupported image type ${type}; use png, jpeg, webp or gif`);
    this.ref = { bytes, type };
    if (!this.dir) return;
    this.removeReferenceFiles();
    await Bun.write(join(this.dir, `_reference.${ext}`), bytes);
  }

  async deleteReference(): Promise<void> {
    this.ref = null;
    this.removeReferenceFiles();
  }

  private removeReferenceFiles(): void {
    if (!this.dir) return;
    for (const ext of Object.values(IMAGE_EXT)) {
      const p = join(this.dir, `_reference.${ext}`);
      if (existsSync(p)) rmSync(p);
    }
  }
}
