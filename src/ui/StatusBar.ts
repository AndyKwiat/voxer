import type { Editor } from "../core/Editor";

export class StatusBar {
  constructor(el: HTMLElement, editor: Editor) {
    const refresh = () => { el.textContent = `${editor.tool} · color ${editor.color + 1} · ${editor.grid.count} voxels`; };
    editor.on("tool", refresh);
    editor.on("color", refresh);
    editor.on("voxels", refresh);
    refresh();
  }
}
