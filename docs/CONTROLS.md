# Controls (source of truth: `src/ui/InputController.ts`; keep `public/index.html` help text in sync)

| Action | Mouse | Trackpad | Keyboard |
|---|---|---|---|
| Apply tool (hold to keep applying) | left-drag | click/drag | — |
| Orbit | right-drag | option/alt-drag, or alt + scroll | Space + drag |
| Pan | middle-drag or shift + left-drag | shift-drag | — |
| Zoom | wheel | two-finger scroll, pinch (arrives as ctrl+wheel) | — |
| Tools | toolbar | | `1`/`2`/`3` or `B`/`E`/`P`; `Tab` cycles |
| Color | palette click | | `[` / `]` |
| Undo / redo | | | `⌘Z` (`Ctrl+Z`) / `⇧⌘Z` or `⌘Y` |
| Save (no prompt once named) | sidebar `Save` | | `⌘S` |
| Save As… | sidebar `Save As…` | | `⇧⌘S` |
| Open a scene | sidebar `Open…` | | `⌘O` |
| Reset view | | | `F` |
| Toggle grid | | | `G` |
| Add color | `+` slot → picker | | |
| Edit color | double-click slot → picker (Esc/Cancel/click-outside cancels) | | |

Ghost cube shows the target cell for the current tool (red for eraser). It hides when the cell is
blocked by the pen's plane lock (below).

Holding the left button with the **pen** keeps placing voxels, but the stroke is locked to a plane:
when you press, the camera direction picks the plane orientation (the one most face-on — looking
top-down locks the horizontal x-z plane; facing a wall locks that wall's plane), and the first voxel
placed fixes where that plane sits. Later cells are skipped unless they lie in it, and the ghost cube
hides for them, so a fast drag stays flat instead of stacking toward the camera. Releasing the button
(which also ends the undo stroke) clears the lock, so the next stroke can pick a new plane. The eraser
and paint tools are not restricted.
