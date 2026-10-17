# src/agent — agent control (in-page side)

How an agent drives the app: **MCP server** (`mcp/server.ts`, stdio) → HTTP `POST /api/rpc` on the app
server → **hub** (`server/Hub.ts`) → WebSocket `/agent` → **`Bridge`** in the active page → **`Api`**
methods on the live `Editor`/`Viewport`. The page is the single source of truth and the renderer.

| File | What |
|---|---|
| `Api.ts` | `createApi(editor, view, reference)` → `window.voxer.api`. One JSON params object in, JSON out: `info`, `run {ops}` (see `core/Commands.ts`), `get_layer`, `new_scene`, `serialize`/`load`, `undo`/`redo`, `set_palette`, `snapshot` (base64 PNG sheet, `render/Capture.ts`), `set_view`, `reference_info`/`reload_reference`/`sample_reference`, `run_script {code}`. |
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
