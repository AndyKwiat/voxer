# server — Bun static server

`index.ts`: `Bun.serve` on `PORT` (default 3005) serving `public/` with path-traversal protection.
Run directly (`import.meta.main`) it also binds terminal keys — `o` opens the app in a browser, `q`/Ctrl-C
quits — skipped when stdin is not a TTY, so tests and `scripts/browser-check.ts` (which import
`startServer`/`handleRequest`, never the main block) are unaffected.
Exports `handleRequest`, `resolvePublicPath`, `startServer(port, root)` so tests can run it on a random port.

## Scenes API (`handleApi`, runs before the static fallback)

| Route | Does |
|---|---|
| `GET /api/scenes` | `{scenes: [{name, bytes, modified}]}`, newest first; `[]` when nothing is saved yet |
| `GET /api/scenes/:name` | the scene JSON, or 404 |
| `PUT /api/scenes/:name` | writes `saves/<name>.json`; 400 if the body does not `decodeScene` |

Scenes live in `saves/` (gitignored), overridable with `VOXER_SCENES` — tests point it at a temp dir.
Names must match `/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/` (`isValidSceneName`): no dots or slashes, so a
name can never escape the directory. The server decodes every PUT with `src/core/Scene`, so it never
stores a file it could not load back. New routes go in `handleApi`, with a test in `test/server.test.ts`.
