# src/ui — DOM views + input

All views are stateless and re-render from `Editor` events. Never store selection in a view.

| File | What |
|---|---|
| `InputController.ts` | Every mouse/trackpad/keyboard binding (documented in `docs/CONTROLS.md`). Drag modes: rotate / pan / paint. |
| `PalettePanel.ts` | Grid of color slots + `+` slot. Click select, dblclick edit → `ColorPicker`. |
| `ColorPicker.ts` | `openColorPicker(initial, title) → Promise<hex|null>`; native color input + hex + RGB fields; Esc/Cancel/backdrop cancel. |
| `Toolbar.ts` | Tool buttons. |
| `SceneBar.ts` | Open / Save / Save As. `save()` only prompts when the scene has no name yet; `saveAs()` always does. |
| `SceneDialogs.ts` | `openNamePrompt(title, initial)` and `openScenePicker(list)` — same modal shell as `ColorPicker`. |
| `scenesApi.ts` | `listScenes/fetchScene/putScene` against `/api/scenes`; throws with the server's error text. |
| `StatusBar.ts` | `scene* · tool · color N · count voxels`. |

Markup and CSS live in `public/index.html` (ids: `view`, `tools`, `scenes`, `palette`, `status`, `help`).
When you change a binding, update the help block in `index.html` and `docs/CONTROLS.md`.
