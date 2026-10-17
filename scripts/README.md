# scripts — dev tooling

| File | What |
|---|---|
| `build.ts` | Recipe builder CLI (`bun run recipe …`): recipe files/dirs → scenes, sheets, variants, meshes, manifest. Format + options: `recipes/README.md` |
| `browser-check.ts` | Headless Chrome smoke test of the real app + screenshot (`docs/TESTING.md`) |
| `lib/chrome.ts` | Headless Chrome launcher over the DevTools protocol (shared with the MCP server) |
| `lib/headless.ts` | `startVoxer({ scratch: true })` → `{ rpc, base, close }`: in-memory app server + headless page, for scripts |
| `lib/recipe.ts` | Recipe format, pure: `normalizeRecipes`/`validateRecipe`, `resolveSlotRefs` (`"slot:roof.dark"`), `expandRecipe` (`build(ctx)`), `batchOps`, `stampAnchors`, `summaryLine` |
| `lib/recipe-build.ts` | `loadRecipes(paths)`, `RecipeBuilder` / `buildRecipes(recipes, host, opts)`: replays recipes (stamped recipes first), writes outputs + `manifest.json`. Shared by `build.ts` and the MCP `build_recipe` tool |
| `lib/recipe-host.ts` | Hosts the builder runs on: `pageHost(rpc)` (a real page — headless or the MCP server's; can render sheets) and `coreHost()` (in-process core `Editor`, no browser; `--no-sheet` and tests) |

Output of `browser-check` goes to `scripts/out/`, recipe builds to `out/recipes/` by default (both gitignored).
