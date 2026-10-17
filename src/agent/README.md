# src/agent — agent control (in-page side)

How an agent drives the app: **MCP server** (`mcp/server.ts`, stdio) → HTTP `POST /api/rpc` on the app
server → **hub** (`server/Hub.ts`) → WebSocket `/agent` → **`Bridge`** in the active page → **`Api`**
methods on the live `Editor`/`Viewport`. The page is the single source of truth and the renderer.

| File | What |
|---|---|
| `Api.ts` | `createApi(editor, view, reference)` → `window.voxer.api`. One JSON params object in, JSON out: `info`, `run {ops}` (async; see `core/Commands.ts` + `core/Parts.ts` — `stamp` ops whose `scene` is a name are first fetched from `/api/scenes/<name>`), `get_layer`, `new_scene`, `serialize`/`load`, `undo`/`redo`, `set_palette`, `snapshot` (base64 PNG sheet, `render/Capture.ts`), `set_view`, `reference_info`/`reload_reference`/`sample_reference`, `run_script {code}` (its `op()` is synchronous, so `stamp` there needs SceneData, not a name), `export_mesh` (see `Export.ts`), slots: `define_slot {name, base, shades?}` or `{name, colors, names?}`, `recolor_slot {name, base}`, `make_variant {slots}` → `{scene, slots}` (current scene untouched), `list_slots`; anchors: `set_anchor {name, x, y, z, dir?, note?}`, `remove_anchor {name}`, `list_anchors`. `snapshot {anchors?}` draws anchors (default on when any exist). |
| `Export.ts` | `exportSceneMesh` (the `export_mesh` API: `{format: glb\|obj\|json, pivot, scale, ao, merge, remap, colorSpace?, name?}` → `{format, mime, filename, bytes, data: base64, stats: {vertices, triangles, bbox}}`) and `downloadSceneMesh` (browser download, used by the sidebar button). |
| `Bridge.ts` | WebSocket client: answers `rpc` messages, applies `load` (scene sync), tracks `active`, pushes `scene` (debounced) after edits while active, reloads the reference on `reference`. Checks `/api/health` first so a page hosted elsewhere stays quiet. |
| `Reference.ts` | `ReferenceImage` (sidebar thumbnail; paste/drop an image; synced with `/api/reference`) and pure-ish `sampleImage` (area-average downsample + k-means → `{grid, legend}` for `layer` ops). |

URL params: `?agent=headless` (set by the MCP server's Chrome; a headless page never takes control from a
visible one), `?noagent` (no hub connection), `?size=N` (initial grid size), `?demo` (demo voxels; also skips the hub).

Active page rules (hub): newest visible page wins; a page that becomes active is first sent the hub's
last scene, so control moves between tabs / from headless to your browser without losing work. With the
real server, that scene is autosaved to `models/_autosave.json`, so reloading the app keeps your model.

`.mcp.json` starts the server through `mcp/run.sh`, which finds `bun` even when the client (e.g. Claude
desktop) doesn't load your shell profile (`$BUN`, PATH, `~/.bun/bin`, Homebrew) and puts it on PATH.

Driving it without MCP: any browser-automation tool can call `window.voxer.api.*` directly.
Adding an API method: add it to `Api.ts`, a tool in `mcp/tools.ts` + handler in `mcp/server.ts`, and docs.

Mesh export: `export_mesh` (API and MCP tool) meshes with `core/GreedyMesher` and writes with `core/MeshExport`.
The MCP tool takes an extra `path`: the MCP server process writes the file there and returns only stats
(without `path` the base64 file is returned). Large scenes produce several MB of base64, so the app server's
WebSocket `maxPayloadLength` is 64 MB.
