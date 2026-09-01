# Scene file format

One scene = one JSON file. Implemented in `src/core/Scene.ts` (pure, tested in `test/Scene.test.ts`);
the server stores them as `saves/<name>.json`.

```json
{
  "format": "voxer-scene",
  "version": 1,
  "size": 32,
  "palette": ["#ffffff", "#c0c0c0", "…"],
  "voxels": { "encoding": "rle-v1", "runs": [32768, 0] }
}
```

| Field | Meaning |
|---|---|
| `format` | Always `"voxer-scene"`. Anything else is rejected — this is how we tell someone else's JSON apart. |
| `version` | Integer, currently `1`. See the rules below. |
| `size` | Grid edge length (1..256). A scene only loads into an editor whose grid is the same size. |
| `palette` | Hex colors, index 0 first. Cell value `n` means `palette[n-1]`; `0` is empty. |
| `voxels.encoding` | Tag naming the payload layout. Only `"rle-v1"` exists so far. |
| `voxels.runs` | Flat run-length pairs `[count, value, …]` in grid index order (`(y*S + z)*S + x`), covering exactly `size³` cells. |

RLE keeps the common case tiny — an empty 32³ scene is `[32768, 0]`, and a typical model is a few KB —
while staying human-readable and diffable. A denser encoding (base64, gzip) can be added later as a new
`encoding` tag without touching `version`.

## Adding features without breaking old files

The whole point of the version + encoding tags is that **old saves keep opening**. The rules:

1. **Adding an optional field does not bump `version`.** Write it, default it when absent on load.
   Old files simply don't have it; new files opened by an old build keep it (see rule 3).
2. **Bump `version` only for a breaking change** — a field changing meaning, or one becoming required.
   When you bump it, add the matching entry to `MIGRATIONS` in `src/core/Scene.ts`: an
   `N → N+1` function. `decodeScene` walks the chain, so a v1 file still opens in a v9 build.
   Add a test that loads a fixture of the old version.
3. **Unknown top-level fields are preserved.** `decodeScene` collects them into `extra`, `Editor` holds
   them, and `encodeScene` writes them back. So if a newer build adds `camera` and an older build opens
   and re-saves that file, the camera survives. Do not reuse a field name for a different meaning.
4. **A file from the future is refused, not guessed at.** `version > SCENE_VERSION` fails with a message
   telling the user their file is newer than this build. Same for an unknown `voxels.encoding`.
5. **Validate on the way in.** `decodeScene` checks sizes, colors, run coverage and that no cell points
   past the palette, and throws `SceneFormatError`. The server runs the same decode before writing, so
   it never stores a file it could not read back.

## Likely next additions (all additive)

`camera` (orbit angles), `meta` (created/modified, author), `layers`, `name`, `thumbnail`. None of these
need a version bump — add the field, default it when missing.
