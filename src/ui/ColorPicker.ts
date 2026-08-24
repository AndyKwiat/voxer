import { hexToRgb, rgbToHex, normalizeHex } from "../core/Palette";

/** Small modal with a native color input, hex field and RGB fields. Resolves with a hex or null (cancelled). */
export function openColorPicker(initial: string, title: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    overlay.innerHTML = `
      <div class="picker" role="dialog">
        <h3>${title}</h3>
        <div class="picker-row"><input type="color" id="pk-color"><span class="swatch" id="pk-swatch"></span></div>
        <div class="picker-row"><label>Hex <input id="pk-hex" maxlength="7" spellcheck="false"></label></div>
        <div class="picker-row">
          <label>R <input type="number" id="pk-r" min="0" max="255"></label>
          <label>G <input type="number" id="pk-g" min="0" max="255"></label>
          <label>B <input type="number" id="pk-b" min="0" max="255"></label>
        </div>
        <div class="picker-actions"><button id="pk-cancel">Cancel</button><button id="pk-ok" class="primary">OK</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const $ = <T extends HTMLElement>(id: string) => overlay.querySelector<T>("#" + id)!;
    const color = $<HTMLInputElement>("pk-color"), hex = $<HTMLInputElement>("pk-hex"), swatch = $("pk-swatch");
    const r = $<HTMLInputElement>("pk-r"), g = $<HTMLInputElement>("pk-g"), b = $<HTMLInputElement>("pk-b");
    let value = normalizeHex(initial) ?? "#ffffff";

    const sync = (from: "color" | "hex" | "rgb" | "init") => {
      if (from === "hex") {
        const n = normalizeHex(hex.value);
        if (!n) return;
        value = n;
      } else if (from === "rgb") {
        value = rgbToHex({ r: +r.value, g: +g.value, b: +b.value });
      } else if (from === "color") value = color.value;
      const rgb = hexToRgb(value)!;
      if (from !== "hex") hex.value = value;
      if (from !== "color") color.value = value;
      if (from !== "rgb") { r.value = `${rgb.r}`; g.value = `${rgb.g}`; b.value = `${rgb.b}`; }
      swatch.style.background = value;
    };
    sync("init");
    color.addEventListener("input", () => sync("color"));
    hex.addEventListener("input", () => sync("hex"));
    for (const el of [r, g, b]) el.addEventListener("input", () => sync("rgb"));

    const close = (result: string | null) => { overlay.remove(); resolve(result); };
    $("pk-cancel").onclick = () => close(null);
    $("pk-ok").onclick = () => close(value);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close(null);
      if (e.key === "Enter") close(value);
      e.stopPropagation();
    });
    hex.focus();
    hex.select();
  });
}
