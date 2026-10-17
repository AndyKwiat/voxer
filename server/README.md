# server — Bun static server + agent API

`index.ts`: `Bun.serve` on `PORT` (default 3005) serving `public/` with path-traversal protection.
Run directly (`import.meta.main`) it also binds terminal keys — `o` opens the app in a browser, `q`/Ctrl-C
quits — skipped when stdin is not a TTY, so tests and `scripts/browser-check.ts` (which import
`startServer`/`handleRequest`, never the main block) are unaffected.
Exports `handleRequest`, `resolvePublicPath`, `startServer(port, root)` so tests can run it on a random port.

`startServer(port, root, { modelsDir? })` also mounts:

| Route | What |
|---|---|
| `GET /api/health` | `{ ok, app: "voxer" }` (the page and MCP server probe it) |
| `WS /agent` | page ↔ `Hub` (messages: page→`hello`/`result`/`error`/`scene`; hub→`rpc`/`load`/`active`/`reference`) |
| `GET /api/agent/status` | connected pages, which is active, headless or not |
| `POST /api/rpc` `{method, params}` | runs `window.voxer.api[method]` in the active page → `{result}`; 503 if no page, 400 on error |
| `GET /api/scene` | last scene the active page pushed |
| `GET/PUT/DELETE /api/reference` | reference image bytes (png/jpeg/webp/gif); PUT/DELETE notify pages |
| `GET /api/scenes`, `GET/PUT /api/scenes/:name` | saved scenes |

`Store` keeps scenes / reference / autosave as files in `modelsDir` (the real server uses `models/`) or in
memory when omitted (tests, browser-check). Add routes in `handleApi`; add a test in `test/server.test.ts`.
