import * as THREE from "three";
import { OrbitCamera, type Projection } from "./OrbitCamera";
import { makeGridLines } from "./GridLines";
import { ChunkedVoxelMesh } from "./ChunkMesher";
import type { Editor } from "../core/Editor";
import type { VoxelGrid } from "../core/VoxelGrid";
import { raycastGrid, type Hit, type Vec3 } from "../core/Raycast";
import type { BoxDraft } from "../core/Editor";

/** Three.js scene bound to an Editor: re-meshes dirty chunks whenever voxels or palette change. */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly orbit: OrbitCamera;
  readonly voxels: ChunkedVoxelMesh;
  private gridLines: THREE.Group;
  private ghost: THREE.Mesh;
  private boxGhost: THREE.Mesh;
  private boxEdges: THREE.LineSegments;
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  /** Fired when a view-only setting changes (projection, grid, outlines) so HUDs can refresh. */
  readonly onViewChange = new Set<() => void>();

  constructor(readonly canvas: HTMLCanvasElement, editor: Editor) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x000000);
    this.orbit = new OrbitCamera(1);
    this.gridLines = makeGridLines(editor.grid.size);
    this.scene.add(this.gridLines);
    this.voxels = new ChunkedVoxelMesh(editor.grid, editor.palette);
    this.scene.add(this.voxels.group, this.voxels.edgeGroup);
    // Light budget: three's Lambert BRDF divides irradiance by PI, so the intensities below sum to
    // ~PI on a sun-facing face — it renders at ~95% of the palette color, and the shaded sides sit
    // around 60-75%. Going brighter clips channels and skews hues (brown reads orange).
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(0.6, 1, 0.4);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-0.5, 0.3, -1);
    this.scene.add(sun, fill);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 1.02, 1.02),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // Box preview: a translucent volume plus a bright outline, sized per draft.
    this.boxGhost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.boxEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    this.boxGhost.visible = this.boxEdges.visible = false;
    this.scene.add(this.boxGhost, this.boxEdges);

    editor.on("voxels", (edits) => {
      for (const e of edits) this.voxels.markVoxel(e.x, e.y, e.z);
      this.invalidate();
    });
    editor.on("palette", () => { this.voxels.markAll(); this.invalidate(); });
    editor.on("box", (draft) => this.showBox(draft, editor.colorHex));

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

  invalidate(): void {
    this.needsRender = true;
  }

  /** Current camera projection. */
  get projection(): Projection {
    return this.orbit.projection;
  }

  /** Swaps perspective ⇄ orthographic (`C`). Returns the new projection. */
  toggleProjection(): Projection {
    const p = this.orbit.toggleProjection();
    this.changed();
    return p;
  }

  private changed(): void {
    this.invalidate();
    for (const f of this.onViewChange) f();
  }

  /** Outlines every visible voxel face (colors stay solid). Returns the new state. */
  toggleEdges(): boolean {
    this.voxels.setEdges(!this.voxels.edgesVisible);
    this.changed();
    return this.voxels.edgesVisible;
  }

  toggleGrid(): void {
    this.gridLines.visible = !this.gridLines.visible;
    this.changed();
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

  /** Cell under the pointer on the horizontal plane `y`, ignoring voxels. Null if the ray misses it. */
  planeCell(clientX: number, clientY: number, y: number, grid: VoxelGrid): Vec3 | null {
    const ray = this.ray(clientX, clientY);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    const p = ray.at(t, new THREE.Vector3());
    const hi = grid.size - 1;
    const c = (n: number) => Math.max(0, Math.min(hi, Math.floor(n)));
    return { x: c(p.x), y, z: c(p.z) };
  }

  /**
   * World height under the pointer, read off a vertical plane through `anchor` that faces the
   * camera — this is what drives the box tool's height phase.
   */
  heightAt(clientX: number, clientY: number, anchor: Vec3): number | null {
    const ray = this.ray(clientX, clientY);
    const fwd = this.viewDirection();
    const n = new THREE.Vector3(fwd.x, 0, fwd.z);
    if (n.lengthSq() < 1e-8) return null; // looking straight down: height is unreadable
    n.normalize();
    const origin = new THREE.Vector3(anchor.x + 0.5, anchor.y, anchor.z + 0.5);
    const denom = n.dot(ray.direction);
    if (Math.abs(denom) < 1e-6) return null;
    const t = n.dot(origin.clone().sub(ray.origin)) / denom;
    if (t < 0) return null;
    return ray.at(t, new THREE.Vector3()).y;
  }

  /** Shows (or hides, with null) the box being drawn. */
  showBox(draft: BoxDraft | null, color = "#ffffff"): void {
    const on = draft !== null;
    this.boxGhost.visible = this.boxEdges.visible = on;
    if (draft) {
      const { min, max } = draft.region;
      const w = max.x - min.x + 1, h = max.y - min.y + 1, d = max.z - min.z + 1;
      for (const o of [this.boxGhost, this.boxEdges]) {
        o.scale.set(w, h, d);
        o.position.set(min.x + w / 2, min.y + h / 2, min.z + d / 2);
      }
      (this.boxGhost.material as THREE.MeshBasicMaterial).color.set(color);
      (this.boxEdges.material as THREE.LineBasicMaterial).color.set(color);
    }
    this.invalidate();
  }

  private ray(clientX: number, clientY: number): THREE.Ray {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.orbit.camera);
    return this.raycaster.ray;
  }

  /** Casts a ray from a client-space point through the voxel grid. */
  pick(grid: VoxelGrid, clientX: number, clientY: number): Hit | null {
    const ray = this.ray(clientX, clientY);
    return raycastGrid(grid, ray.origin, ray.direction);
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
