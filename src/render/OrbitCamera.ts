import * as THREE from "three";

export type Projection = "perspective" | "orthographic";

const FOV = 50;

/**
 * Simple orbit camera: rotate around a target, pan the target, dolly zoom.
 * Holds one perspective and one orthographic camera in the same pose, so `C` can swap between them
 * without the view jumping — the ortho frustum is sized from the same distance and field of view.
 */
export class OrbitCamera {
  private perspective: THREE.PerspectiveCamera;
  private orthographic: THREE.OrthographicCamera;
  private _projection: Projection = "perspective";
  private aspect: number;
  target = new THREE.Vector3();
  theta = 0.6; // azimuth
  phi = 1.0; // polar (0 = top)
  distance = 120;
  minDistance = 2;
  maxDistance = 1500;

  constructor(aspect: number) {
    this.aspect = aspect;
    this.perspective = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 5000);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
    this.reset();
  }

  /** The camera currently in use — render and raycast through this. */
  get camera(): THREE.Camera {
    return this._projection === "perspective" ? this.perspective : this.orthographic;
  }

  get projection(): Projection {
    return this._projection;
  }

  /** Switches projection, keeping the same pose and apparent size. Returns the new one. */
  toggleProjection(): Projection {
    this._projection = this._projection === "perspective" ? "orthographic" : "perspective";
    this.apply();
    return this._projection;
  }

  reset(): void {
    this.target.set(16, 6, 16);
    this.theta = 0.7;
    this.phi = 1.05;
    this.distance = 70;
    this.apply();
  }

  rotate(dx: number, dy: number): void {
    this.theta -= dx * 0.006;
    this.phi = THREE.MathUtils.clamp(this.phi - dy * 0.006, 0.02, Math.PI - 0.02);
    this.apply();
  }

  pan(dx: number, dy: number): void {
    const scale = this.distance * 0.0016;
    const cam = this.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    this.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.apply();
  }

  zoom(delta: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(delta * 0.0015), this.minDistance, this.maxDistance);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.applyOrthoFrustum();
  }

  /** Half-height the perspective camera covers at the target: what the ortho box matches. */
  private applyOrthoFrustum(): void {
    const h = Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * this.distance;
    const w = h * this.aspect;
    const o = this.orthographic;
    o.left = -w; o.right = w; o.top = h; o.bottom = -h;
    o.updateProjectionMatrix();
  }

  private apply(): void {
    const sp = Math.sin(this.phi);
    const pos = new THREE.Vector3(
      this.target.x + this.distance * sp * Math.sin(this.theta),
      this.target.y + this.distance * Math.cos(this.phi),
      this.target.z + this.distance * sp * Math.cos(this.theta),
    );
    for (const cam of [this.perspective, this.orthographic]) {
      cam.position.copy(pos);
      cam.lookAt(this.target);
      cam.updateMatrix();
    }
    this.applyOrthoFrustum();
  }
}
