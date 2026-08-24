import type { Editor } from "../core/Editor";
import { TOOLS, type ToolName } from "../core/Tools";

const LABELS: Record<ToolName, string> = { pen: "Pen (1)", eraser: "Eraser (2)", paint: "Paint (3)" };

export class Toolbar {
  constructor(container: HTMLElement, editor: Editor) {
    const buttons = new Map<ToolName, HTMLButtonElement>();
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.className = "tool";
      b.textContent = LABELS[t];
      b.onclick = () => editor.setTool(t);
      container.appendChild(b);
      buttons.set(t, b);
    }
    const sync = (tool: ToolName) => { for (const [k, b] of buttons) b.classList.toggle("selected", k === tool); };
    editor.on("tool", sync);
    sync(editor.tool);
  }
}
