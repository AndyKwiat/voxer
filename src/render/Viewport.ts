import * as THREE from "three";
import { OrbitCamera } from "./OrbitCamera";
import { makeGridLines } from "./GridLines";
import { ChunkedVoxelMesh } from "./ChunkMesher";
import type { Editor } from "../core/Editor";
import type { VoxelGrid } from "../core/VoxelGrid";
import { raycastGrid, type Hit, type Vec3 } from "../core/Raycast";

/** Three.js scene bound to an Editor: re-meshes dirty chunks whenever voxels or palette change. */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly orbit: OrbitCamera;
  voxels: ChunkedVoxelMesh;
  private gridLines: THREE.Group;
  private ghost: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private needsRender = true;

  constructor(readonly canvas: HTMLCanvasElement, private editor: Editor) {
    // alpha so snapshots can render with a transparent background; the live view sets an opaque one.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x000000);
    this.orbit = new OrbitCamera(1);
    this.orbit.gridSize = editor.grid.size;
    this.orbit.reset();
    this.gridLines = makeGridLines(editor.grid.size);
    this.scene.add(this.gridLines);
    this.voxels = new ChunkedVoxelMesh(editor.grid, editor.palette);
    this.scene.add(this.voxels.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, 1, 0.4);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-0.5, 0.3, -1);
    this.scene.add(sun, fill);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 1.02, 1.02),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    editor.on("voxels", (edits) => {
      for (const e of edits) this.voxels.markVoxel(e.x, e.y, e.z);
      this.invalidate();
    });
    editor.on("palette", () => { this.voxels.markAll(); this.invalidate(); });
    editor.on("reset", () => this.rebuild());

    this.resize();
    window.addEventListener("resize", () => this.resize());
    const loop = () => {
      if (this.needsRender) {
        this.needsRender = false;
        this.voxels.update();
        this.renderer.render(this.scene, this.orbit.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Rebuilds grid lines + meshes after the editor's grid was replaced, and reframes the camera. */
  private rebuild(): void {
    const grid = this.editor.grid;
    this.scene.remove(this.gridLines, this.voxels.group);
    disposeTree(this.gridLines);
    this.voxels.dispose();
    const gridVisible = this.gridLines.visible;
    this.gridLines = makeGridLines(grid.size);
    this.gridLines.visible = gridVisible;
    this.voxels = new ChunkedVoxelMesh(grid, this.editor.palette);
    this.voxels.markAllCells();
    this.scene.add(this.gridLines, this.voxels.group);
    this.ghost.visible = false;
    this.orbit.gridSize = grid.size;
    this.orbit.reset();
    this.invalidate();
  }

  /**
   * Renders the scene once with another camera into a new `px`-square 2D canvas, without disturbing
   * the live view (the live frame is re-rendered before returning, in the same task). With
   * `transparent`, empty space has alpha 0 so callers can composite their own backdrop.
   */
  renderOffscreen(camera: THREE.Camera, px: number, opts: { grid: boolean; transparent: boolean; flat?: boolean }): HTMLCanvasElement {
    const r = this.renderer;
    const ratio = r.getPixelRatio(), bg = this.scene.background, colorSpace = r.outputColorSpace;
    const gridWas = this.gridLines.visible, ghostWas = this.ghost.visible;
    this.voxels.update();
    this.gridLines.visible = opts.grid;
    this.ghost.visible = false;
    if (opts.transparent) { this.scene.background = null; r.setClearColor(0x000000, 0); }
    // Flat: unlit, and vertex colors (raw palette bytes / 255) written out unconverted = exact hex colors.
    if (opts.flat) { this.voxels.setFlat(true); r.outputColorSpace = THREE.LinearSRGBColorSpace; }
    r.setPixelRatio(1);
    r.setSize(px, px, false);
    r.render(this.scene, camera);
    const out = document.createElement("canvas");
    out.width = out.height = px;
    out.getContext("2d")!.drawImage(r.domElement, 0, 0);
    this.scene.background = bg;
    r.setClearColor(0x000000, 1);
    if (opts.flat) { this.voxels.setFlat(false); r.outputColorSpace = colorSpace; }
    this.gridLines.visible = gridWas;
    this.ghost.visible = ghostWas;
    r.setPixelRatio(ratio);
    this.resize();
    r.render(this.scene, this.orbit.camera);
    return out;
  }

  invalidate(): void {
    this.needsRender = true;
  }

  get gridVisible(): boolean {
    return this.gridLines.visible;
  }

  toggleGrid(): void {
    this.gridLines.visible = !this.gridLines.visible;
    this.invalidate();
  }

  resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.orbit.setAspect(w / h);
    this.invalidate();
  }

  /** Unit vector the camera is looking along, in world space. */
  viewDirection(): Vec3 {
    const d = this.orbit.camera.getWorldDirection(new THREE.Vector3());
    return { x: d.x, y: d.y, z: d.z };
  }

  /** Casts a ray from a client-space point through the voxel grid. */
  pick(grid: VoxelGrid, clientX: number, clientY: number): Hit | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.orbit.camera);
    return raycastGrid(grid, this.raycaster.ray.origin, this.raycaster.ray.direction);
  }

  /** Shows a translucent cube at a cell (or hides it when null). */
  showGhost(cell: Vec3 | null, color = "#ffffff"): void {
    const wasVisible = this.ghost.visible;
    this.ghost.visible = cell !== null;
    if (cell) {
      this.ghost.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      (this.ghost.material as THREE.MeshBasicMaterial).color.set(color);
      this.invalidate();
    } else if (wasVisible) this.invalidate();
  }
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
