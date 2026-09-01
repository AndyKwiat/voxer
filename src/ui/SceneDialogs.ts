import type { SceneListing } from "./scenesApi";

/** Shared modal shell: same look as the color picker, Esc / backdrop cancel. */
function modal<T>(html: string, wire: (root: HTMLElement, close: (v: T | null) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    overlay.innerHTML = `<div class="picker" role="dialog">${html}</div>`;
    document.body.appendChild(overlay);
    const close = (v: T | null) => { overlay.remove(); resolve(v); };
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
      e.stopPropagation(); // don't let tool shortcuts fire while typing
    });
    wire(overlay, close);
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Asks for a scene name. Resolves with the trimmed name, or null if cancelled. */
export function openNamePrompt(title: string, initial = ""): Promise<string | null> {
  return modal<string>(
    `<h3>${esc(title)}</h3>
     <div class="picker-row"><label>Name <input id="sc-name" maxlength="64" spellcheck="false" value="${esc(initial)}"></label></div>
     <div class="picker-hint" id="sc-err"></div>
     <div class="picker-actions"><button id="sc-cancel">Cancel</button><button id="sc-ok" class="primary">Save</button></div>`,
    (root, close) => {
      const input = root.querySelector<HTMLInputElement>("#sc-name")!;
      const err = root.querySelector<HTMLElement>("#sc-err")!;
      const submit = () => {
        const v = input.value.trim();
        // Same rule as the server, so a bad name is caught before the round trip.
        if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(v)) {
          err.textContent = "Letters, numbers, spaces, - and _ only.";
          return;
        }
        close(v);
      };
      root.querySelector<HTMLElement>("#sc-cancel")!.onclick = () => close(null);
      root.querySelector<HTMLElement>("#sc-ok")!.onclick = submit;
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      input.focus();
      input.select();
    },
  );
}

/** Lists saved scenes and resolves with the chosen name, or null. */
export function openScenePicker(scenes: readonly SceneListing[]): Promise<string | null> {
  const rows = scenes.length
    ? scenes.map((s) => `<button class="scene-row" data-name="${esc(s.name)}">
         <span>${esc(s.name)}</span><span class="scene-meta">${new Date(s.modified).toLocaleString()}</span>
       </button>`).join("")
    : `<div class="picker-hint">No saved scenes yet.</div>`;
  return modal<string>(
    `<h3>Open scene</h3><div class="scene-list">${rows}</div>
     <div class="picker-actions"><button id="sc-cancel">Cancel</button></div>`,
    (root, close) => {
      root.querySelector<HTMLElement>("#sc-cancel")!.onclick = () => close(null);
      for (const row of root.querySelectorAll<HTMLElement>(".scene-row")) {
        row.onclick = () => close(row.dataset["name"]!);
      }
    },
  );
}
