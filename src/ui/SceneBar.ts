import type { Editor } from "../core/Editor";
import { openNamePrompt, openScenePicker } from "./SceneDialogs";
import { fetchScene, listScenes, putScene } from "./scenesApi";

/**
 * Open / Save / Save As buttons. `save()` writes straight to the current scene name and only asks
 * for one the first time (or via Save As). All scene state lives on `Editor` (`sceneName`, `dirty`).
 */
export class SceneBar {
  private status: HTMLElement;

  constructor(el: HTMLElement, private editor: Editor) {
    el.innerHTML = `
      <button class="tool" id="sc-open">Open…</button>
      <button class="tool" id="sc-save">Save <span class="key">⌘S</span></button>
      <button class="tool" id="sc-saveas">Save As…</button>
      <div class="scene-status" id="sc-status"></div>`;
    this.status = el.querySelector<HTMLElement>("#sc-status")!;
    el.querySelector<HTMLElement>("#sc-open")!.onclick = () => void this.open();
    el.querySelector<HTMLElement>("#sc-save")!.onclick = () => void this.save();
    el.querySelector<HTMLElement>("#sc-saveas")!.onclick = () => void this.saveAs();
    editor.on("scene", () => this.refresh());
    this.refresh();
  }

  private refresh(): void {
    const name = this.editor.sceneName;
    this.status.textContent = name ? `${name}${this.editor.dirty ? " •" : ""}` : "unsaved scene";
    this.status.title = this.editor.dirty ? "unsaved changes" : "saved";
  }

  private flash(message: string, error = false): void {
    this.status.textContent = message;
    this.status.classList.toggle("error", error);
    setTimeout(() => { this.status.classList.remove("error"); this.refresh(); }, error ? 4000 : 1200);
  }

  /** Saves to the current name, asking for one only if the scene has never been named. */
  async save(): Promise<void> {
    const name = this.editor.sceneName;
    if (!name) return this.saveAs();
    await this.write(name);
  }

  /** Always asks for a name, pre-filled with the current one. */
  async saveAs(): Promise<void> {
    const name = await openNamePrompt("Save scene as", this.editor.sceneName ?? "");
    if (name) await this.write(name);
  }

  async open(): Promise<void> {
    try {
      const name = await openScenePicker(await listScenes());
      if (!name) return;
      this.editor.loadScene(await fetchScene(name), name);
      this.flash(`opened ${name}`);
    } catch (e) {
      this.flash(`open failed: ${(e as Error).message}`, true);
    }
  }

  private async write(name: string): Promise<void> {
    try {
      await putScene(name, this.editor.toScene());
      this.editor.markSaved(name);
      this.flash(`saved ${name}`);
    } catch (e) {
      this.flash(`save failed: ${(e as Error).message}`, true);
    }
  }
}
