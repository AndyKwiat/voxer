import * as THREE from "three";

/** Lines are split into short pieces: some GL drivers (e.g. SwiftShader) drop long lines that cross the near plane. */
const PIECE = 16;

/** Floor (y=0), back wall (z=0) and left wall (x=0) with a line every cell, brighter every 16. */
export function makeGridLines(size: number): THREE.Group {
  const group = new THREE.Group();
  const minor: number[] = [];
  const major: number[] = [];
  // Pushes a line from a to b (axis-aligned), split into PIECE-length segments.
  const push = (arr: number[], a: [number, number, number], b: [number, number, number]) => {
    const axis = a[0] !== b[0] ? 0 : a[1] !== b[1] ? 1 : 2;
    for (let s = a[axis]; s < b[axis]; s += PIECE) {
      const p = [...a] as [number, number, number];
      const q = [...a] as [number, number, number];
      p[axis] = s;
      q[axis] = Math.min(s + PIECE, b[axis]);
      arr.push(...p, ...q);
    }
  };
  for (let i = 0; i <= size; i++) {
    const arr = i % 16 === 0 ? major : minor;
    push(arr, [i, 0, 0], [i, 0, size]); // floor
    push(arr, [0, 0, i], [size, 0, i]);
    push(arr, [i, 0, 0], [i, size, 0]); // back wall z=0
    push(arr, [0, i, 0], [size, i, 0]);
    push(arr, [0, 0, i], [0, size, i]); // left wall x=0
    push(arr, [0, i, 0], [0, i, size]);
  }
  const mk = (arr: number[], color: number) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
  };
  group.add(mk(minor, 0x4a4a4a));
  group.add(mk(major, 0x9a9a9a));
  return group;
}
