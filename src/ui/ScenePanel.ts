import type { Editor } from "../core/Editor";
import type { SceneData } from "../core/Scene";

const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;

/** New / Save / Load buttons over the server's `/api/scenes` (files in `models/`). */
export class ScenePanel {
  /** Default for the Save dialog: the last name saved or loaded. */
  private lastName = "";

  constructor(container: HTMLElement, private editor: Editor) {
    const button = (label: string, title: string, fn: () => void) => {
      const b = document.createElement("button");
      b.className = "tool";
      b.textContent = label;
      b.title = title;
      b.onclick = fn;
      container.appendChild(b);
    };
    button("New", "Clear to an empty scene", () => this.newScene());
    button("Save", "Save to models/<name>.json", () => void this.save());
    button("Load", "Load a saved scene", () => void this.load());
  }

  private newScene(): void {
    if (this.editor.grid.count && !confirm("Clear the scene? Unsaved changes are lost (the previous autosave is overwritten).")) return;
    this.editor.newScene();
  }

  private async save(): Promise<void> {
    const name = await dialog<string>("Save scene", (body, done) => {
      const input = document.createElement("input");
      input.className = "scene-name";
      input.value = this.lastName;
      input.placeholder = "name";
      input.spellcheck = false;
      const err = document.createElement("div");
      err.className = "scene-err";
      body.append(input, err);
      const submit = () => {
        const v = input.value.trim();
        if (!NAME.test(v)) { err.textContent = "Use letters, digits, - _ . (up to 64)"; return; }
        done(v);
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      setTimeout(() => { input.focus(); input.select(); });
      return { ok: submit };
    });
    if (!name) return;
    const existing = await listScenes();
    if (existing.includes(name) && name !== this.lastName && !confirm(`Overwrite "${name}"?`)) return;
    const r = await fetch(`/api/scenes/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(this.editor.serialize()) }).catch(() => null);
    if (!r?.ok) { alert(`Save failed: ${r ? ((await r.json()) as { error: string }).error : "server unreachable"}`); return; }
    this.lastName = name;
  }

  private async load(): Promise<void> {
    const names = await listScenes();
    const name = await dialog<string>("Load scene", (body, done) => {
      if (!names.length) { body.textContent = "No saved scenes yet."; return {}; }
      const list = document.createElement("div");
      list.className = "scene-list";
      for (const n of names) {
        const b = document.createElement("button");
        b.textContent = n;
        b.onclick = () => done(n);
        list.appendChild(b);
      }
      body.appendChild(list);
      return {};
    });
    if (!name) return;
    const r = await fetch(`/api/scenes/${encodeURIComponent(name)}`).catch(() => null);
    if (!r?.ok) { alert(`Could not load "${name}"`); return; }
    if (this.editor.grid.count && !confirm(`Replace the current scene with "${name}"?`)) return;
    this.editor.load((await r.json()) as SceneData);
    this.lastName = name;
  }
}

async function listScenes(): Promise<string[]> {
  const r = await fetch("/api/scenes").catch(() => null);
  return r?.ok ? ((await r.json()) as { scenes: string[] }).scenes : [];
}

/**
 * Minimal modal in the color picker's style. `build` fills the body and calls `done(value)`;
 * it may return an `ok` handler to show an OK button. Resolves null on cancel / Esc / backdrop.
 */
function dialog<T>(title: string, build: (body: HTMLElement, done: (v: T) => void) => { ok?: () => void }): Promise<T | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    const box = document.createElement("div");
    box.className = "picker";
    box.setAttribute("role", "dialog");
    const h = document.createElement("h3");
    h.textContent = title;
    const body = document.createElement("div");
    body.className = "picker-row scene-body";
    const actions = document.createElement("div");
    actions.className = "picker-actions";
    box.append(h, body, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = (v: T | null) => { overlay.remove(); resolve(v); };
    const { ok } = build(body, (v) => close(v));
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.onclick = () => close(null);
    actions.appendChild(cancel);
    if (ok) {
      const b = document.createElement("button");
      b.className = "primary";
      b.textContent = "Save";
      b.onclick = ok;
      actions.appendChild(b);
    }
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") close(null); e.stopPropagation(); });
    overlay.tabIndex = -1;
    overlay.focus();
  });
}
