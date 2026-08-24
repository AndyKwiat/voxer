import type { Editor } from "../core/Editor";
import { MAX_COLORS } from "../core/Palette";
import { openColorPicker } from "./ColorPicker";

/** Scrollable palette grid: click selects, double-click edits, trailing "+" adds. */
export class PalettePanel {
  private el = document.createElement("div");

  constructor(container: HTMLElement, private editor: Editor) {
    this.el.className = "palette";
    container.appendChild(this.el);
    editor.on("palette", () => this.render());
    editor.on("color", () => this.render());
    this.render();
  }

  private render(): void {
    const { palette, color } = this.editor;
    this.el.replaceChildren();
    for (let i = 0; i < palette.length; i++) {
      const hex = palette.get(i)!;
      const b = document.createElement("button");
      b.className = "slot" + (i === color ? " selected" : "");
      b.style.background = hex;
      b.title = `${hex}  (click: select, double-click: edit)`;
      b.onclick = () => this.editor.setColor(i);
      b.ondblclick = async () => {
        const v = await openColorPicker(hex, `Edit color ${i + 1}`);
        if (v) palette.update(i, v);
      };
      this.el.appendChild(b);
    }
    if (palette.length < MAX_COLORS) {
      const add = document.createElement("button");
      add.className = "slot empty";
      add.title = "Add a color";
      add.textContent = "+";
      add.onclick = async () => {
        const v = await openColorPicker("#ffffff", "New color");
        if (v) this.editor.addColor(v);
      };
      this.el.appendChild(add);
    }
  }
}
