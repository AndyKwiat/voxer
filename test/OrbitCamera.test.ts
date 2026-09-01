import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { OrbitCamera } from "../src/render/OrbitCamera";

describe("OrbitCamera", () => {
  test("starts perspective and toggles to orthographic and back", () => {
    const c = new OrbitCamera(16 / 9);
    expect(c.projection).toBe("perspective");
    expect(c.camera.type).toBe("PerspectiveCamera");
    expect(c.toggleProjection()).toBe("orthographic");
    expect(c.camera.type).toBe("OrthographicCamera");
    expect(c.toggleProjection()).toBe("perspective");
    expect(c.camera.type).toBe("PerspectiveCamera");
  });

  test("both cameras share the pose, so switching does not move the view", () => {
    const c = new OrbitCamera(1.5);
    c.rotate(40, -20);
    c.zoom(-300);
    const before = c.camera.position.clone();
    const aim = c.camera.getWorldDirection(new THREE.Vector3());
    c.toggleProjection();
    expect(c.camera.position.distanceTo(before)).toBeLessThan(1e-6);
    expect(c.camera.getWorldDirection(new THREE.Vector3()).angleTo(aim)).toBeLessThan(1e-6);
  });

  test("the ortho frustum matches what the perspective camera covers at the target", () => {
    const aspect = 2;
    const c = new OrbitCamera(aspect);
    c.toggleProjection();
    const o = c.camera as THREE.OrthographicCamera;
    const h = Math.tan(THREE.MathUtils.degToRad(50) / 2) * c.distance;
    expect(o.top).toBeCloseTo(h, 6);
    expect(o.right).toBeCloseTo(h * aspect, 6);
    expect(o.bottom).toBeCloseTo(-h, 6);
    expect(o.left).toBeCloseTo(-h * aspect, 6);
  });

  test("zoom and resize keep the ortho frustum in step", () => {
    const c = new OrbitCamera(1);
    c.toggleProjection();
    const o = c.camera as THREE.OrthographicCamera;
    const wide = o.right;
    c.zoom(500); // dolly out
    expect(o.right).toBeGreaterThan(wide);
    c.setAspect(3);
    expect(o.right / o.top).toBeCloseTo(3, 6);
  });

  test("reset restores the default framing without changing projection", () => {
    const c = new OrbitCamera(1);
    c.toggleProjection();
    c.rotate(100, 50);
    c.reset();
    expect(c.projection).toBe("orthographic");
    expect(c.distance).toBe(70);
    expect(c.target.toArray()).toEqual([16, 6, 16]);
  });
});
