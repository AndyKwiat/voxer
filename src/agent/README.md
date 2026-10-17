# src/agent — agent control (in-page side)

How an agent drives the app: **MCP server** (`mcp/server.ts`, stdio) → HTTP `POST /api/rpc` on the app
server → **hub** (`server/Hub.ts`) → WebSocket `/agent` → **`Bridge`** in the active page → **`Api`**
methods on the live `Editor`/`Viewport`. The page is the single source of truth and the renderer.

| File | What |
|---|---|
| `Api.ts` | `createApi(editor, view, reference)` → `window.voxer.api`. One JSON params object in, JSON out: `info`, `run {ops}` (async; see `core/Commands.ts` + `core/Parts.ts` — `stamp` ops whose `scene` is a name are first fetched from `/api/scenes/<name>`; returns `{changed, count, summary, report}`, see `core/Report.ts`), `get_layer`, `new_scene`, `serialize`/`load`, `undo`/`redo`, `set_palette`, `snapshot` (base64 PNG sheet, `render/Capture.ts`), `set_view`, `reference_info`/`reload_reference`/`sample_reference`, `run_script {code}` (returns a write report too; its `op()` is synchronous, so `stamp` there needs SceneData, not a name), `export_mesh` (see `Export.ts`), slots: `define_slot {name, base, shades?}` or `{name, colors, names?}`, `recolor_slot {name, base}`, `make_variant {slots}` → `{scene, slots}` (current scene untouched), `list_slots`; anchors: `set_anchor {name, x, y, z, dir?, note?}`, `remove_anchor {name}`, `list_anchors`. `snapshot {anchors?, figure?}` draws anchors (default on when any exist). `lint {…opts}` → `core/Lint.ts` result. |
| `Export.ts` | `exportSceneMesh` (the `export_mesh` API: `{format: glb\|obj\|json, pivot, scale, ao, merge, remap, colorSpace?, name?}` → `{format, mime, filename, bytes, data: base64, stats: {vertices, triangles, bbox}}`) and `downloadSceneMesh` (browser download, used by the sidebar button). |
| `Bridge.ts` | WebSocket client: answers `rpc` messages, applies `load` (scene sync), tracks `active`, pushes `scene` (debounced) after edits while active — and flushes a pending push before each RPC reply, so the hub always has the scene a completed call produced — reloads the reference on `reference`. Checks `/api/health` first so a page hosted elsewhere stays quiet. |
| `Reference.ts` | `ReferenceImage` (sidebar thumbnail; paste/drop an image; synced with `/api/reference`) and pure-ish `sampleImage` (area-average downsample + k-means → `{grid, legend}` for `layer` ops). |

URL params: `?agent=headless` (set by the MCP server's Chrome; a headless page never takes control from a
visible one), `?noagent` (no hub connection), `?size=N` (initial grid size), `?demo` (demo voxels; also skips the hub).

Active page rules (hub): newest visible page wins; a page that becomes active is first sent the hub's
last scene, so control moves between tabs / from headless to your browser without losing work. With the
real server, that scene is autosaved to `models/_autosave.json`, so reloading the app keeps your model.

`.mcp.json` starts the server through `mcp/run.sh`, which finds `bun` even when the client (e.g. Claude
desktop) doesn't load your shell profile (`$BUN`, PATH, `~/.bun/bin`, Homebrew) and puts it on PATH.

**Scratch mode** (`VOXER_SCRATCH=1 bun mcp/server.ts` or `--scratch`): the MCP server always starts its own
in-memory app server on a private random port (`VOXER_PORT` to pin it) — no autosave, nothing written to `models/`,
and your browser tab on 3005 is a different hub, so neither can take over the other. `save_scene {name}` then stays
in memory; `save_scene {path}` / `load_scene {path}` (absolute paths) work in both modes.

**Snapshots** via MCP are retried (`mcp/snapshot.ts`): each attempt times out after `VOXER_SNAPSHOT_TIMEOUT_MS`
(default 20 s); a timeout retries with ≤200 px tiles and ≤2 views, then (if the page is the server's own headless
Chrome) relaunches it and tries once more. The tool text says `DEGRADED …` with what was reduced. `figure: true`
(`figure_height`, default 8) draws a scale person beside the model (`render/ScaleFigure.ts`); the page API takes
`snapshot({ figure: true | height })`.

Driving it without MCP: `scripts/lib/headless.ts` — `startVoxer({ scratch: true })` → `{ rpc, base, close }` runs
an in-memory server + headless Chrome for scripts. Any browser-automation tool can also call `window.voxer.api.*` directly.
Adding an API method: add it to `Api.ts`, a tool in `mcp/tools.ts` + handler in `mcp/server.ts`, and docs.

Mesh export: `export_mesh` (API and MCP tool) meshes with `core/GreedyMesher` and writes with `core/MeshExport`.
The MCP tool takes an extra `path`: the MCP server process writes the file there and returns only stats
(without `path` the base64 file is returned). Large scenes produce several MB of base64, so the app server's
WebSocket `maxPayloadLength` is 64 MB.
**Recipes** (`build_recipe {path, out_dir?, only?, export?, figure?, sheet?, show_sheet?}`): builds recipe files
(`recipes/README.md`) on the current page with the shared builder (`scripts/lib/recipe-build.ts`, the same code as
`bun run recipe`), writes `<out>/<name>.json`, variants, meshes, `sheets/<name>.png` and `manifest.json`, and returns
one summary line per model + JSON with the file paths (plus the sheet image when one model was built). The last model
stays loaded. Failing recipes make the call an error whose text still lists every model.

MCP `draw`, `run_script` and `lint` return text that starts with the human-readable summary (`WARNING:` lines
first, e.g. `WARNING: op 1 (ellipsoid): 30 cells clipped outside the grid (x 32..33; grid 0..31)`), followed by
the JSON result on the next line (old fields `changed`, `count`, `bbox`, `colorsUsed` are kept).
