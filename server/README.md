# server — Bun static server

`index.ts`: `Bun.serve` on `PORT` (default 3000) serving `public/` with path-traversal protection.
Exports `handleRequest`, `resolvePublicPath`, `startServer(port, root)` so tests can run it on a random port.

Planned: `GET/PUT /api/scenes/:name` for save/load (see `docs/ARCHITECTURE.md`). Add routes inside
`handleRequest` before the static fallback; add a test in `test/server.test.ts`.
