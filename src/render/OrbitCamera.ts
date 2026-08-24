import * as THREE from "three";

/** Simple orbit camera: rotate around a target, pan the target, dolly zoom. */
export class OrbitCamera {
  readonly camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  theta = 0.6; // azimuth
  phi = 1.0; // polar (0 = top)
  distance = 120;
  minDistance = 2;
  maxDistance = 1500;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 5000);
    this.reset();
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
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.apply();
  }

  zoom(delta: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(delta * 0.0015), this.minDistance, this.maxDistance);
    this.apply();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private apply(): void {
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.distance * sp * Math.sin(this.theta),
      this.target.y + this.distance * Math.cos(this.phi),
      this.target.z + this.distance * sp * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrix();
  }
}
