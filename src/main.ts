import { Editor } from "./core/Editor";
import { Palette } from "./core/Palette";
import { Viewport } from "./render/Viewport";
import { InputController } from "./ui/InputController";
import { SceneBar } from "./ui/SceneBar";
import { PalettePanel } from "./ui/PalettePanel";
import { StatusBar } from "./ui/StatusBar";
import { Toolbar } from "./ui/Toolbar";

const $ = (id: string) => document.getElementById(id)!;

const editor = new Editor();
const view = new Viewport($("view") as HTMLCanvasElement, editor);
new Toolbar($("tools"), editor);
new PalettePanel($("palette"), editor);
new StatusBar($("status"), editor);
const scenes = new SceneBar($("scenes"), editor);
new InputController(editor, view, {
  save: () => void scenes.save(),
  saveAs: () => void scenes.saveAs(),
  open: () => void scenes.open(),
});

// ?demo places a few voxels so the scene isn't empty (handy for smoke tests).
if (new URLSearchParams(location.search).has("demo")) {
  for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) editor.setRaw(x + 4, 0, z + 4, Palette.toCell(((x + z) % 8) + 6));
  for (let y = 1; y < 6; y++) editor.setRaw(7, y, 7, Palette.toCell(12));
  editor.setRaw(0, 3, 0, Palette.toCell(1));
}

// Debug handle for the browser console.
(window as unknown as { voxer: unknown }).voxer = { editor, view, scenes };
