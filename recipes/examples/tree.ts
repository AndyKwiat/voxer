// A small round tree built procedurally: build(ctx) with a seeded RNG, slot colors via ctx.slots,
// sparse ctx.set painting (like the waldo G sketchpad) plus ordinary ops. Variant: autumn leaves.
import type { RecipeContext } from "../../scripts/lib/recipe";

export default {
  name: "tree",
  size: 24,
  slots: {
    leaf: { base: "#3aa848", shades: { dark: 0.8, light: 1.2, tip: 1.45 } },
    trunk: { base: "#7a5232", shades: { dark: 0.74 } },
  },
  build(ctx: RecipeContext) {
    const rnd = ctx.rng(7), c = 12, leaf = ctx.slots.leaf!, trunk = ctx.slots.trunk!;
    // trunk: 2×2, darker on the +x side, with two roots and two branches
    ctx.box([c, 0, c], [c, 7, c + 1], "slot:trunk");
    ctx.box([c + 1, 0, c], [c + 1, 7, c + 1], "slot:trunk.dark");
    ctx.set(c - 1, 0, c, trunk.base!);
    ctx.set(c + 2, 0, c + 1, trunk.dark!);
    ctx.add({ op: "line", from: [c, 6, c], to: [c - 3, 9, c], color: "slot:trunk" }, { op: "line", from: [c + 1, 6, c + 1], to: [c + 4, 9, c + 1], color: "slot:trunk.dark" });
    // canopy: overlapping blobs with ragged edges, shaded dark → light by height plus noise
    const blobs: [number, number, number, number][] = [[c + 0.5, 12, c + 0.5, 6], [c - 3.5, 10, c, 4.5], [c + 4.5, 10, c + 1, 4.5], [c, 10, c - 3.5, 4.5], [c + 1, 10, c + 4.5, 4.5], [c + 0.5, 15.5, c + 0.5, 4]];
    const cells: [number, number, number][] = [];
    for (const [cx, cy, cz, r] of blobs) {
      const ry = r * 0.85;
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
        for (let z = Math.floor(cz - r); z <= cz + r; z++)
          for (let x = Math.floor(cx - r); x <= cx + r; x++) {
            const d = ((x - cx) / r) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / r) ** 2;
            if (d <= 1 && !(d > 0.8 && rnd() < 0.35)) cells.push([x, y, z]);
          }
    }
    const top = Math.max(...cells.map((p) => p[1])), bot = Math.min(...cells.map((p) => p[1]));
    for (const [x, y, z] of cells) {
      const t = (y - bot) / (top - bot) + (rnd() - 0.5) * 0.35;
      ctx.set(x, y, z, t > 0.85 ? leaf.tip! : t > 0.55 ? leaf.light! : t > 0.25 ? leaf.base! : leaf.dark!);
    }
    ctx.anchor("top", { x: c, y: top, z: c, dir: "+y" });
  },
  anchors: { base: { x: 12, y: 0, z: 12, note: "trunk foot" } },
  variants: { autumn: { leaf: "#d08a30" } },
};
