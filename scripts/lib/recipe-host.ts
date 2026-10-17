/**
 * Hosts the recipe builder runs against. A host is an `rpc(method, params, timeoutMs?)` with the page API's
 * method names and result shapes (`src/agent/Api.ts`), plus whether it can render snapshot sheets.
 *
 * - `pageHost(rpc)`: a real Voxer page — headless (`scripts/lib/headless.ts`) or the MCP server's page.
 * - `coreHost()`: an in-process `core/Editor`, no browser. Same scene results (the page runs the same
 *   Editor), but no `snapshot`. Used by `bun scripts/build.ts --no-sheet` and the tests.
 */
import { exportSceneMesh } from "../../src/agent/Export";
import type { Op } from "../../src/core/Commands";
import { Editor } from "../../src/core/Editor";
import { lint } from "../../src/core/Lint";
import { formatReport } from "../../src/core/Report";
import type { SceneData } from "../../src/core/Scene";
import { slotSummary } from "../../src/core/Slots";

export type Rpc = (method: string, params?: unknown, timeoutMs?: number) => Promise<any>;

export interface RecipeHost {
  rpc: Rpc;
  /** Can render `snapshot` sheets. */
  canSnapshot: boolean;
  /** Called before the last snapshot attempt (e.g. relaunch a stalled headless page). */
  recover?: () => Promise<void>;
  log?: (msg: string) => void;
}

export function pageHost(rpc: Rpc, extra: Partial<RecipeHost> = {}): RecipeHost {
  return { rpc, canSnapshot: true, ...extra };
}

/** In-process host over a core `Editor` (no rendering). `editor` is exposed for tests. */
export function coreHost(): RecipeHost & { editor: Editor } {
  const editor = new Editor();
  const methods: Record<string, (p: any) => unknown> = {
    info: () => editor.info(),
    new_scene: (p) => { editor.newScene(p?.size, p?.palette); return editor.info(); },
    serialize: () => editor.serialize(),
    load: (p: { scene: SceneData }) => { editor.load(p.scene); return editor.info(); },
    run: (p: { ops: Op[] }) => {
      for (const o of p.ops) if (o.op === "stamp" && typeof o.scene === "string") throw new Error(`stamp: scene names ("${o.scene}") need a page; use recipe: or a .json path`);
      const { changed, report } = editor.runReport(p.ops);
      return { changed, count: editor.grid.count, summary: formatReport(report), report };
    },
    define_slot: (p) => ({ name: p.name, ...editor.defineSlot(p.name, p.base, p.shades) }),
    make_variant: (p) => { const scene = editor.makeVariant(p.slots); return { scene, slots: slotSummary(scene.slots ?? {}, scene.palette) }; },
    set_anchor: (p) => { const { name, ...a } = p; return { name, ...editor.setAnchor(name, a) }; },
    lint: (p) => lint(editor.grid, editor.palette.all(), p ?? {}),
    export_mesh: (p) => exportSceneMesh(editor, p ?? {}),
  };
  return {
    editor,
    canSnapshot: false,
    async rpc(method, params = {}) {
      const m = methods[method];
      if (!m) throw new Error(`${method}: not available without a page (core host)`);
      return m(params);
    },
  };
}
