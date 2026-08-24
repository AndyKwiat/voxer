# src/ui — DOM views + input

All views are stateless and re-render from `Editor` events. Never store selection in a view.

| File | What |
|---|---|
| `InputController.ts` | Every mouse/trackpad/keyboard binding (documented in `docs/CONTROLS.md`). Drag modes: rotate / pan / paint. |
| `PalettePanel.ts` | Grid of color slots + `+` slot. Click select, dblclick edit → `ColorPicker`. |
| `ColorPicker.ts` | `openColorPicker(initial, title) → Promise<hex|null>`; native color input + hex + RGB fields; Esc/Cancel/backdrop cancel. |
| `Toolbar.ts` | Tool buttons. |
| `StatusBar.ts` | `tool · color N · count voxels`. |

Markup and CSS live in `public/index.html` (ids: `view`, `tools`, `palette`, `status`, `help`).
When you change a binding, update the help block in `index.html` and `docs/CONTROLS.md`.
