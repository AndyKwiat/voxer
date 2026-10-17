// One-storey Chinese village house: examples/house.json as a recipe, with material slots
// (roof / wall / pillar), anchors and a gold-roof variant. Build: bun run recipe recipes/examples/house.js
export default {
  name: "house",
  description: "One-storey village house (rebuild of the waldo 'home1' recipe) from parts-library ops.",
  size: 40,
  // Shade factors match what the parts derive from a base color, so every derived shade is a slot entry
  // and recolor_slot / variants move the whole ramp.
  slots: {
    roof: { base: "#3a9ab0", shades: { dark: 0.74, light: 1.22, cap: 1.42, ridge: 0.45, side: 0.86 } },
    wall: { base: "#f6e8c8", shades: { dark: 0.93, light: 1.04, shadow: 0.72 } },
    pillar: { base: "#d0402e", shades: { cap: 0.74 } },
  },
  ops: [
    { op: "box", min: [5, 0, 10], max: [34, 0, 31], color: "#8a867e" },
    { op: "box", min: [6, 0, 11], max: [33, 0, 30], pattern: "noise", colors: ["#c8c4b8", "#a8a49a"], density: 0.1 },
    { op: "walls", min: [8, 1, 12], max: [31, 12, 27], color: "slot:wall", skirt: true, posts: "slot:pillar", postTop: "slot:pillar.cap" },
    { op: "door", at: [18, 1, 27], size: [4, 9], plaque: true },
    { op: "window", at: [10, 4, 27], size: [4, 5] },
    { op: "window", at: [26, 4, 27], size: [4, 5], style: "slats" },
    { op: "window", at: [12, 4, 12], face: "-z", size: [4, 5] },
    { op: "window", at: [24, 4, 12], face: "-z", size: [4, 5] },
    { op: "window", at: [8, 4, 18], face: "-x", size: [4, 5], style: "slats" },
    { op: "window", at: [31, 4, 18], face: "+x", size: [4, 5], style: "slats" },
    { op: "pillar", at: [[8, 1, 29], [14, 1, 29], [25, 1, 29], [31, 1, 29]], height: 12, color: "slot:pillar", capital: "slot:pillar.cap" },
    { op: "beam", from: [8, 12, 29], to: [31, 12, 29] },
    { op: "beam", from: [8, 12, 28], to: [31, 12, 28] },
    { op: "lantern", at: [[11, 11, 29], [28, 11, 29]] },
    {
      op: "roof", min: [4, 9], max: [35, 31], eave: 0, y: 13, color: "slot:roof",
      ramp: { dark: "slot:roof.dark", light: "slot:roof.light", cap: "slot:roof.cap", ridge: "slot:roof.ridge", side: "slot:roof.side" },
    },
    // woodpile and water barrel
    { op: "box", min: [32, 1, 11], max: [34, 2, 13], color: "#b07a44" },
    { op: "box", min: [33, 1, 13], max: [33, 2, 13], color: "#5e3a1e" },
    { op: "box", min: [32, 3, 11], max: [33, 4, 12], color: "#8a5a32" },
    { op: "box", min: [5, 1, 29], max: [6, 2, 30], color: "#2f6fa8" },
    { op: "set", voxels: [[5, 3, 29, "#2f6fa8"], [6, 3, 30, "#2a1f2d"]] },
  ],
  anchors: {
    door: { x: 20, y: 0, z: 31, dir: "+z", note: "in front of the door, on the platform edge" },
    roof_top: { x: 20, y: 22, z: 20, dir: "+y", note: "top of the ridge, centre" },
  },
  variants: { gold: { roof: "#e8b830" } },
  // the village materials include deliberate near-duplicates (door shadow vs pillar cap, skirt vs platform)
  lint: { palette: false },
};
