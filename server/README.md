# server — Bun static server

`index.ts`: `Bun.serve` on `PORT` (default 3005) serving `public/` with path-traversal protection.
Run directly (`import.meta.main`) it also binds terminal keys — `o` opens the app in a browser, `q`/Ctrl-C
quits — skipped when stdin is not a TTY, so tests and `scripts/browser-check.ts` (which import
`startServer`/`handleRequest`, never the main block) are unaffected.
Exports `handleRequest`, `resolvePublicPath`, `startServer(port, root)` so tests can run it on a random port.

Planned: `GET/PUT /api/scenes/:name` for save/load (see `docs/ARCHITECTURE.md`). Add routes inside
`handleRequest` before the static fallback; add a test in `test/server.test.ts`.
