import type { SceneFile } from "../core/Scene";

export interface SceneListing {
  name: string;
  bytes: number;
  modified: string;
}

async function fail(r: Response): Promise<never> {
  const body = await r.json().catch(() => null);
  throw new Error((body as { error?: string } | null)?.error ?? `request failed (${r.status})`);
}

/** Names of saved scenes, newest first. */
export async function listScenes(): Promise<SceneListing[]> {
  const r = await fetch("/api/scenes");
  if (!r.ok) await fail(r);
  return (await r.json()).scenes as SceneListing[];
}

export async function fetchScene(name: string): Promise<unknown> {
  const r = await fetch(`/api/scenes/${encodeURIComponent(name)}`);
  if (!r.ok) await fail(r);
  return r.json();
}

export async function putScene(name: string, doc: SceneFile): Promise<void> {
  const r = await fetch(`/api/scenes/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!r.ok) await fail(r);
}
