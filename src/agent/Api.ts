import * as THREE from "three";
import type { Anchor } from "../core/Anchors";
import { applyOp, Draft, type Color, type Op } from "../core/Commands";
import type { Editor } from "../core/Editor";
import type { ExportOptions } from "../core/MeshExport";
import { Palette } from "../core/Palette";
import type { SceneData } from "../core/Scene";
import { slotSummary } from "../core/Slots";
import type { Axis } from "../core/Tools";
import { EMPTY } from "../core/VoxelGrid";
import { canvasToBase64, snapshotSheet } from "../render/Capture";
import type { Viewport } from "../render/Viewport";
import { AXIS_VIEW_DEFS, ISO_DIRS, isAxisView, isViewName, VIEW_NAMES, type ViewName } from "../render/Views";
import { exportSceneMesh } from "./Export";
import { sampleImage, type ReferenceImage, type SampleOptions } from "./Reference";

/**
 * The agent-facing API: every method takes one JSON params object and returns JSON (images as base64).
 * Exposed as `window.voxer.api` and driven over WebSocket by `Bridge` (MCP server → hub → this).
 */
export function createApi(editor: Editor, view: Viewport, reference: ReferenceImage) {
  const api = {
    info: () => editor.info(),

    /** Runs a batch of drawing ops as one undo step. */
    run: (p: { ops: Op[] }) => {
      if (!Array.isArray(p?.ops)) throw new Error("run: expected { ops: [...] }");
      const changed = editor.run(p.ops);
      return { changed, count: editor.grid.count };
    },

    get_layer: (p: { axis: Axis; index: number; crop?: { a0: number; a1: number; b0: number; b1: number } }) => {
      checkAxis(p.axis);
      return editor.dumpLayer(p.axis, p.index, p.crop);
    },

    new_scene: (p: { size?: number; palette?: string[] } = {}) => {
      editor.newScene(p.size, p.palette);
      return editor.info();
    },
    serialize: (): SceneData => editor.serialize(),
    load: (p: { scene: SceneData }) => {
      editor.load(p.scene);
      return editor.info();
    },

    undo: () => ({ undone: editor.undo(), count: editor.grid.count }),
    redo: () => ({ redone: editor.redo(), count: editor.grid.count }),

    /** Replaces palette colors by index (voxels keep their indices, so this recolors them). */
    set_palette: (p: { colors: string[] }) => {
      editor.palette.replaceAll(p.colors);
      return { palette: [...editor.palette.all()] };
    },

    snapshot: (p: { views?: ViewName[]; tile?: number; frame?: "content" | "grid"; reference?: boolean; columns?: number; shading?: "flat" | "lit" } = {}) => {
      for (const v of p.views ?? []) if (!isViewName(v)) throw new Error(`unknown view "${v}"; one of ${VIEW_NAMES.join(", ")}`);
      const sheet = snapshotSheet(view, editor, { ...p, reference: p.reference ? reference.image : null });
      return { mime: "image/png", width: sheet.width, height: sheet.height, data: canvasToBase64(sheet), hasReference: !!reference.image };
    },

    /** Points the live (visible) camera at a named view. */
    set_view: (p: { view: ViewName }) => {
      const s = editor.grid.size, target = new THREE.Vector3(s / 2, s / 2, s / 2);
      if (isAxisView(p.view)) {
        const f = AXIS_VIEW_DEFS[p.view].forward;
        view.orbit.lookFrom({ x: -f.x, y: -f.y, z: -f.z }, target, s * 2.4);
      } else if (isViewName(p.view)) view.orbit.lookFrom(ISO_DIRS[p.view], target, s * 2.4);
      else { view.orbit.reset(); }
      view.invalidate();
      return { view: p.view };
    },

    reference_info: () => {
      const img = reference.image;
      return img ? { width: img.naturalWidth, height: img.naturalHeight } : null;
    },
    reload_reference: async () => {
      await reference.refresh();
      return api.reference_info();
    },
    sample_reference: (p: SampleOptions = {}) => {
      if (!reference.image) throw new Error("no reference image (paste one into the app or call set_reference)");
      return sampleImage(reference.image, p);
    },

    /**
     * Runs JS for procedural geometry. In scope: `S` (grid size), `get(x,y,z)` (palette index or -1),
     * `set(x,y,z,color|null)`, `op(opObject)`, `Math`. All writes form one undo step; the return value
     * is passed back. Throws discard everything.
     */
    run_script: (p: { code: string }) => {
      const d = new Draft(editor.grid);
      const resolve = (c: Color) => Palette.toCell(editor.palette.resolve(c));
      const get = (x: number, y: number, z: number) => { const v = d.get(x, y, z); return v === EMPTY ? -1 : Palette.fromCell(v); };
      const set = (x: number, y: number, z: number, c: Color | null) => d.set(x, y, z, c === null ? EMPTY : resolve(c));
      const op = (o: Op) => applyOp(d, o, resolve);
      const fn = new Function("S", "get", "set", "op", `"use strict";\n${p.code}`) as (...a: unknown[]) => unknown;
      const result = fn(editor.grid.size, get, set, op);
      const edits = d.edits();
      editor.applyEdits(edits);
      return { changed: edits.length, count: editor.grid.count, result: result ?? null };
    },

    /** Meshes the scene (greedy, AO baked into vertex colors) and returns the file as base64 + stats. */
    export_mesh: (p: ExportOptions = {}) => exportSceneMesh(editor, p),
    /**
     * Named material slot (`core/Slots.ts`). `{name, base, shades?}` adds a shade ramp of `base` to the
     * palette (shades: name → factor or hex) and returns the hexes to paint with; `{name, colors, names?}`
     * adopts existing palette colors (hex or index; first = base).
     */
    define_slot: (p: { name: string; base?: string; shades?: Record<string, number | string>; colors?: (string | number)[]; names?: string[] }) => {
      if (p?.colors !== undefined) {
        if (p.base !== undefined) throw new Error("define_slot: give either base (+ shades) or colors, not both");
        return { name: p.name, ...editor.adoptSlot(p.name, p.colors, p.names) };
      }
      if (typeof p?.base !== "string") throw new Error("define_slot: expected { name, base, shades? } or { name, colors }");
      return { name: p.name, ...editor.defineSlot(p.name, p.base, p.shades) };
    },
    /** Re-derives every palette entry of a slot from a new base color (recolors its voxels). */
    recolor_slot: (p: { name: string; base: string }) => ({ name: p?.name, ...editor.recolorSlot(p?.name, p?.base) }),
    /** The current scene with slots recolored (`{slots: {roof: "#e8b830"}}`); the current scene is unchanged. */
    make_variant: (p: { slots: Record<string, string> }) => {
      const scene = editor.makeVariant(p?.slots);
      return { scene, slots: slotSummary(scene.slots ?? {}, scene.palette) };
    },
    list_slots: () => editor.listSlots(),

    /** Named anchor (`core/Anchors.ts`): a cell plus optional dir ("+x"…"-z") and note. Replaces an existing one. */
    set_anchor: (p: { name: string } & Anchor) => {
      const { name, ...a } = p ?? ({} as never);
      return { name, ...editor.setAnchor(name, a) };
    },
    remove_anchor: (p: { name: string }) => ({ removed: editor.removeAnchor(p?.name) }),
    list_anchors: () => editor.anchors,
  };
  return api;
}

export type Api = ReturnType<typeof createApi>;

function checkAxis(a: unknown): asserts a is Axis {
  if (a !== "x" && a !== "y" && a !== "z") throw new Error(`axis must be "x", "y" or "z"`);
}
