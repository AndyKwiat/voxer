// Composition: a walled courtyard with two copies of the `house` recipe and one `tree`, stamped in.
// `{ op: "stamp", recipe: "house" }` makes the builder build that recipe first (by name, from the files
// being built or a sibling house.js/.ts/.json) and paste its scene; "./tree.ts" names a file directly.
export default {
  name: "courtyard",
  size: 72,
  // Same roof slot as house.js: the stamped roof colors land on these palette entries, so recolor_slot /
  // variants of the courtyard still recolor the main hall's roof.
  slots: {
    roof: { base: "#3a9ab0", shades: { dark: 0.74, light: 1.22, cap: 1.42, ridge: 0.45, side: 0.86 } },
    paving: { base: "#b8b2a6", shades: { dark: 0.86 } },
  },
  ops: [
    // paved yard with a checker path to the gate
    { op: "box", min: [2, 0, 2], max: [69, 0, 69], pattern: "noise", colors: ["slot:paving", "slot:paving.dark"], density: 0.12, seed: 3 },
    { op: "box", min: [44, 0, 30], max: [49, 0, 69], pattern: "checker", colors: ["#a8a49a", "#c8c4b8"], scale: 2 },
    // main hall at the back, facing the gate (+z)
    // anchorPrefix carries the house's anchors (door, roof_top) along as hall_door, hall_roof_top
    { op: "stamp", recipe: "house", at: [30, 1, 3], anchorPrefix: "hall_" },
    // side house on the west, turned to face +x, with a red roof (reshade moves the whole roof ramp)
    { op: "stamp", recipe: "house", at: [3, 1, 33], rot: 1, reshade: { "slot:roof": "#c04030" }, anchorPrefix: "west_" },
    { op: "stamp", recipe: "./tree.ts", at: [52, 1, 44] },
    // perimeter wall with a gate gap on the front (+z) side
    { op: "walls", min: [1, 0, 1], max: [70, 5, 70], color: "#d8d0c0", mottle: 0.08, top: "#8a867e", skirt: 1 },
    { op: "arch", min: [43, 1, 70], max: [50, 5, 70], axis: "z" },
    { op: "pillar", at: [[42, 0, 70], [51, 0, 70]], height: 8 },
    { op: "beam", from: [42, 7, 70], to: [51, 7, 70] },
  ],
  anchors: {
    gate: { x: 46, y: 1, z: 71, dir: "+z", note: "outside the gate" },
  },
  variants: { autumn: { roof: "#7a4a8a" } },
  lint: { palette: false },
};
