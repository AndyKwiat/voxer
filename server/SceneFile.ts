import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { isSceneData, type SceneData } from "../src/core/Scene";

export { isSceneData };

function checkPath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error(`path must be an absolute file path (got ${JSON.stringify(path)})`);
}

/**
 * Writes a scene to an arbitrary absolute path (creating parent directories), so agents can save into
 * their own project instead of `models/`. Returns the path written.
 */
export async function writeSceneFile(path: string, scene: SceneData): Promise<string> {
  checkPath(path);
  if (!isSceneData(scene)) throw new Error("not a scene { version: 1|2, size, palette, data }");
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(scene));
  return path;
}

/** Reads and validates a scene JSON file from an absolute path. */
export async function readSceneFile(path: string): Promise<SceneData> {
  checkPath(path);
  const f = Bun.file(path);
  if (!(await f.exists())) throw new Error(`no file at ${path}`);
  const s = await f.json().catch(() => null);
  if (!isSceneData(s)) throw new Error(`${path} is not a Voxer scene { version: 1|2, size, palette, data }`);
  return s;
}
