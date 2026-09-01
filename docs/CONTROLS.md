# Controls (source of truth: `src/ui/InputController.ts`; keep `public/index.html` help text in sync)

| Action | Mouse | Trackpad | Keyboard |
|---|---|---|---|
| Apply tool (hold to keep applying) | left-drag | click/drag | — |
| Orbit | right-drag | option/alt-drag, or alt + scroll | Space + drag |
| Pan | middle-drag or shift + left-drag | shift-drag | — |
| Zoom | wheel | two-finger scroll, pinch (arrives as ctrl+wheel) | — |
| Tools | toolbar | | `1`/`2`/`3`/`4` or `B`/`E`/`P`/`X`; `Tab` cycles |
| Color | palette click | | `[` / `]` |
| Undo / redo | | | `⌘Z` (`Ctrl+Z`) / `⇧⌘Z` or `⌘Y` |
| Save (no prompt once named) | sidebar `Save` | | `⌘S` |
| Save As… | sidebar `Save As…` | | `⇧⌘S` |
| Open a scene | sidebar `Open…` | | `⌘O` |
| Reset view | | | `F` |
| Toggle grid | | | `G` |
| Toggle voxel outlines | | | `W` |
| Perspective ⇄ orthographic | | | `C` |
| Add color | `+` slot → picker | | |
| Edit color | double-click slot → picker (Esc/Cancel/click-outside cancels) | | |

**Box tool** (`4` / `X`) draws in two phases:
1. **Footprint** — press and drag. The cell you press on fixes a horizontal plane; dragging rubber-bands
   a rectangle on it (the pointer follows that plane, so you can drag out over empty space).
2. **Height** — release the button. Now moving the pointer raises or lowers the top; the status bar shows
   the live `w×h×d`. **Click** to place the box, or **Esc** to cancel — the box tool stays selected, ready for the next one.

Like the pen, the box only fills empty cells, and the whole box is a single undo step. Switching tools
mid-draw discards it.

The readout in the top-right corner of the viewport shows the current camera projection and the
`x y z` of the cell under the pointer (the cell the tool would act on; `—` when the pointer is off
the grid). While a box is being drawn it follows the far corner of the box.

`C` swaps between the perspective camera (default) and an orthographic one. Both share the same pose
and the ortho frustum is sized from the perspective field of view at the target, so the view does not
jump; orbit, pan, zoom and picking all behave the same in either.

`W` outlines every visible voxel face with a thin dark border. Colors stay solid and lit — it is not a
wireframe, it just makes individual cells readable in a large block.

Ghost cube shows the target cell for the current tool (red for eraser). It hides when the cell is
blocked by the pen's plane lock (below).

Holding the left button with the **pen** keeps placing voxels, but the stroke is locked to a plane:
when you press, the camera direction picks the plane orientation (the one most face-on — looking
top-down locks the horizontal x-z plane; facing a wall locks that wall's plane), and the first voxel
placed fixes where that plane sits. Later cells are skipped unless they lie in it, and the ghost cube
hides for them, so a fast drag stays flat instead of stacking toward the camera. Releasing the button
(which also ends the undo stroke) clears the lock, so the next stroke can pick a new plane. The eraser
and paint tools are not restricted.
