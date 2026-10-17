import { createApi } from "./agent/Api";
import { Bridge } from "./agent/Bridge";
import { ReferenceImage } from "./agent/Reference";
import { Editor } from "./core/Editor";
import { Palette } from "./core/Palette";
import { VoxelGrid } from "./core/VoxelGrid";
import { Viewport } from "./render/Viewport";
import { InputController } from "./ui/InputController";
import { PalettePanel } from "./ui/PalettePanel";
import { ScenePanel } from "./ui/ScenePanel";
import { StatusBar } from "./ui/StatusBar";
import { Toolbar } from "./ui/Toolbar";

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);

const size = Number(params.get("size") ?? 32);
const editor = new Editor(new VoxelGrid(Number.isInteger(size) && size > 0 && size <= 256 ? size : 32));
const view = new Viewport($("view") as HTMLCanvasElement, editor);
new Toolbar($("tools"), editor);
new ScenePanel($("scene"), editor);
new PalettePanel($("palette"), editor);
new StatusBar($("status"), editor);
new InputController(editor, view);

// ?demo places a few voxels so the scene isn't empty (handy for smoke tests).
const demo = params.has("demo");
if (demo) {
  for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) editor.setRaw(x + 4, 0, z + 4, Palette.toCell(((x + z) % 8) + 6));
  for (let y = 1; y < 6; y++) editor.setRaw(7, y, 7, Palette.toCell(12));
  editor.setRaw(0, 3, 0, Palette.toCell(1));
}

// Agent control (see src/agent/README.md). ?noagent opts out of the hub connection.
const reference = new ReferenceImage($("reference"), !params.has("noagent"));
const api = createApi(editor, view, reference);
if (!params.has("noagent") && !demo) {
  void reference.refresh();
  new Bridge(editor, api, reference, $("agent"), params.get("agent") === "headless");
}

// Debug / automation handle for the browser console and browser-automation agents.
(window as unknown as { voxer: unknown }).voxer = { editor, view, api };
