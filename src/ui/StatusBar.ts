import type { Editor } from "../core/Editor";
import { boxSize } from "../core/Tools";

export class StatusBar {
  constructor(el: HTMLElement, editor: Editor) {
    const refresh = () => {
      const scene = editor.sceneName ? `${editor.sceneName}${editor.dirty ? "*" : ""} · ` : "";
      const draft = editor.boxDraft;
      // While drawing a box, its dimensions are the useful number, not the tool name.
      const tool = draft ? `box ${boxSize(draft.region).join("×")}` : editor.tool;
      el.textContent = `${scene}${tool} · color ${editor.color + 1} · ${editor.grid.count} voxels`;
    };
    editor.on("tool", refresh);
    editor.on("color", refresh);
    editor.on("voxels", refresh);
    editor.on("scene", refresh);
    editor.on("box", refresh);
    refresh();
  }
}
