---
name: add-tool
description: Add a new editing tool (e.g. fill, box, eyedropper) end-to-end — core planning logic, tests, editor wiring, toolbar button, keyboard shortcut, docs. Use when asked to add or change a tool.
---

# Add a tool

Tools are pure functions over a `Hit` and the grid; the Editor applies them through History.

1. `src/core/Tools.ts`: add the name to `ToolName` + `TOOLS`; extend `targetCell` and `planEdit`.
   A tool that touches many cells should return `Edit[]` — add a `planEdits` variant and have
   `Editor.applyTool` push each through `history.apply` inside the current stroke, emitting one `voxels` event.
2. `test/Tools.test.ts` (+ `test/Editor.test.ts`): cover target cell, no-op cases, out-of-bounds.
3. `src/ui/Toolbar.ts`: add a label; `src/ui/InputController.ts`: add a shortcut key.
4. Ghost preview: `Editor.previewCell` — return the primary cell or null.
5. Docs: `docs/CONTROLS.md`, help block in `public/index.html`, `src/core/README.md`, tick `docs/ROADMAP.md`.
6. `bun test && bun run typecheck && bun run build`, then `/browser-check` and inspect the screenshot.
