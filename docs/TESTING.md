# Testing

## Unit tests — `bun test`
One file per module in `test/`. Core modules have full coverage of behaviour; render modules are tested
where pure (`buildChunkGeometry`, `ChunkedVoxelMesh` dirty tracking, `makeGridLines`). The server test
spins up `Bun.serve` on a random port against a temp dir.

Add a test when you: change any `src/core` behaviour, add a tool, change meshing/grid geometry, add a route.

## Browser check — `bun scripts/browser-check.ts [url] [out.png] [js-expr ...]`
Launches headless Chrome (SwiftShader) with remote debugging, loads the app from a temporary server,
evaluates each JS expression in the page and saves a screenshot. Defaults: `?demo` scene, screenshot to
`scripts/out/browser-check.png`. In-page helpers are available:
- `voxer.editor`, `voxer.view` — live objects
- `ev(type, x, y, button?)` — synthetic pointer event on the canvas at canvas-relative px
- `key(k, opts?)` — synthetic keydown on window

Example:
```sh
bun scripts/browser-check.ts --demo out.png \
  "ev('pointerdown',500,500);ev('pointerup',500,500); voxer.editor.grid.count" \
  "key('z',{metaKey:true}); voxer.editor.grid.count"
```
Then *look at the screenshot* (Read tool) — it's the only way to catch rendering regressions.

Known SwiftShader quirks: drops `gl.LINES` whose endpoint crosses the near plane (hence 16-unit grid pieces);
`ReadPixels` perf warnings in console are noise.

## Definition of done
`bun test` green, `bun run typecheck` clean, `bun run build` succeeds, and for anything visible a
browser-check screenshot was inspected.
