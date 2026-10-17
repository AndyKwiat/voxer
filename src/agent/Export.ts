import type { Editor } from "../core/Editor";
import { bytesToBase64, exportMesh, type ExportOptions, type MeshStats } from "../core/MeshExport";

export interface MeshExportResult {
  format: string;
  mime: string;
  /** Suggested file name, e.g. "voxer.glb". */
  filename: string;
  /** File size in bytes. */
  bytes: number;
  /** base64 of the file. */
  data: string;
  stats: MeshStats;
}

/** `export_mesh` API: the live scene → GLB / OBJ / JSON mesh file (see `core/MeshExport.ts`). */
export function exportSceneMesh(editor: Editor, p: ExportOptions = {}): MeshExportResult {
  const r = exportMesh(editor.grid, editor.palette.all(), p ?? {});
  return { format: r.format, mime: r.mime, filename: `${p?.name ?? "voxer"}.${r.extension}`, bytes: r.bytes.byteLength, data: bytesToBase64(r.bytes), stats: r.stats };
}

/** Browser download of the current scene as a file (sidebar "Export .glb"). */
export function downloadSceneMesh(editor: Editor, p: ExportOptions = {}): MeshExportResult {
  const r = exportMesh(editor.grid, editor.palette.all(), p);
  const name = `${p.name ?? "voxer"}.${r.extension}`;
  const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { format: r.format, mime: r.mime, filename: name, bytes: r.bytes.byteLength, data: "", stats: r.stats };
}
