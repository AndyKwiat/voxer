---
name: browser-check
description: Verify a UI/render change in the real app by driving headless Chrome — evaluate JS in the page, synthesize input, take and inspect a screenshot. Use after any change to src/render, src/ui, public/index.html, or before saying a visible feature works.
---

# Browser check

1. Build first: `bun run build`.
2. Run `bun scripts/browser-check.ts [--demo] [out.png] "<js expr>" ...`
   - Helpers in page: `voxer.editor`, `voxer.view`, `ev(type,x,y,button?)` (canvas px), `key(k,{metaKey,shiftKey,...})`.
   - Expressions may be async IIFEs; return a string/number so it prints. Picker actions resolve on a
     microtask — `await new Promise(r=>setTimeout(r,50))` before reading results.
3. **Read the screenshot** (Read tool on the png path). Check: black background, grid floor + 2 walls,
   sidebar, voxels lit and colored, ghost cube where expected.
4. Exit code 1 means an uncaught exception was logged — fix it.

Typical assertions:
```
"ev('pointerdown',500,500);ev('pointerup',500,500); voxer.editor.grid.count"       # pen places on floor
"key('z',{metaKey:true}); voxer.editor.grid.count"                                  # undo
"key('2'); ev('pointerdown',500,500);ev('pointerup',500,500); voxer.editor.grid.count"  # eraser
"voxer.view.renderer.info.render"                                                   # draw calls/lines/tris
```
Known quirk: SwiftShader drops long `gl.LINES` crossing the near plane — keep grid lines in short pieces.
