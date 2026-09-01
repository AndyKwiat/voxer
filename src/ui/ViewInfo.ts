import type { Editor } from "../core/Editor";
import type { Viewport } from "../render/Viewport";

/** Corner readout: camera projection and the cell under the pointer. */
export class ViewInfo {
  constructor(el: HTMLElement, editor: Editor, view: Viewport) {
    const cam = document.createElement("div");
    const pos = document.createElement("div");
    pos.className = "hud-pos";
    el.append(cam, pos);

    const refresh = () => {
      cam.textContent = view.projection === "perspective" ? "perspective (C)" : "orthographic (C)";
      const c = editor.hoverCell;
      pos.textContent = c ? `x ${c.x}  y ${c.y}  z ${c.z}` : "—";
    };
    editor.on("hover", refresh);
    view.onViewChange.add(refresh);
    refresh();
  }
}
