import { downloadSceneMesh } from "../agent/Export";
import type { Editor } from "../core/Editor";

/** Sidebar "Export .glb" button: downloads the scene as glTF binary (greedy mesh, AO in vertex colors). */
export class ExportButton {
  constructor(container: HTMLElement, editor: Editor) {
    const b = document.createElement("button");
    b.className = "tool export";
    b.textContent = "Export .glb";
    b.title = "Download the model as glTF binary (merged faces, ambient occlusion in vertex colors)";
    b.onclick = () => {
      if (!editor.grid.count) { alert("Nothing to export: the scene is empty."); return; }
      downloadSceneMesh(editor, { format: "glb" });
    };
    container.appendChild(b);
  }
}
