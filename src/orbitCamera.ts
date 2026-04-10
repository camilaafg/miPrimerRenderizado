import type { Mat4, Vec3 } from "./math";
import { mat4, vec3 } from "./math";

export class OrbitCamera {
  position: Vec3 = [0, 0.8, 6.0];
  target: Vec3 = [0, 0, 0];
  yaw = -Math.PI / 2;
  pitch = 0.15;

  distance = 5.5;
  minDistance = 2.0;
  maxDistance = 20.0;

  moveSpeed = 2.5;
  turnSpeed = 1.9;

  private clampPitch() {
    const limit = Math.PI / 2 - 0.01;
    if (this.pitch > limit) this.pitch = limit;
    if (this.pitch < -limit) this.pitch = -limit;
  }

  private clampDistance() {
    if (this.distance < this.minDistance) this.distance = this.minDistance;
    if (this.distance > this.maxDistance) this.distance = this.maxDistance;
  }

  private syncPosition() {
    const cp = Math.cos(this.pitch);
    const offset: Vec3 = [
      Math.cos(this.yaw) * cp * this.distance,
      Math.sin(this.pitch) * this.distance,
      Math.sin(this.yaw) * cp * this.distance,
    ];
    this.position = vec3.add(this.target, offset);
  }

  fitToSphere(radius: number, fov: number, aspect: number) {
    const halfY = fov * 0.5;
    const halfX = Math.atan(Math.tan(halfY) * aspect);
    const limiting = Math.min(halfX, halfY);
    const fitDistance = radius / Math.sin(limiting);

    this.target = [0, 0, 0];
    this.distance = fitDistance + radius * 0.6;
    this.minDistance = Math.max(radius * 1.1, 0.6);
    this.maxDistance = Math.max(radius * 8, this.distance * 2.5);
    this.clampDistance();
    this.syncPosition();
  }

  zoom(delta: number) {
    this.distance *= Math.exp(delta * 0.001);
    this.clampDistance();
    this.syncPosition();
  }

  setDistance(distance: number) {
    this.distance = distance;
    this.clampDistance();
    this.syncPosition();
  }

  setZoomPercent(percent: number) {
    const t = Math.max(0, Math.min(1, percent));
    this.setDistance(this.maxDistance - t * (this.maxDistance - this.minDistance));
  }

  getZoomPercent(): number {
    const range = this.maxDistance - this.minDistance;
    if (range <= 1e-6) return 1;
    return (this.maxDistance - this.distance) / range;
  }

  getForward(): Vec3 {
    return vec3.normalize(vec3.sub(this.target, this.position));
  }

  getViewMatrix(): Mat4 {
    this.syncPosition();
    return mat4.lookAt(this.position, this.target, [0, 1, 0]);
  }

  update(keys: Set<string>, dt: number) {
    if (keys.has("ArrowLeft")) this.yaw -= this.turnSpeed * dt;
    if (keys.has("ArrowRight")) this.yaw += this.turnSpeed * dt;
    if (keys.has("ArrowUp")) this.pitch += this.turnSpeed * dt;
    if (keys.has("ArrowDown")) this.pitch -= this.turnSpeed * dt;
    this.clampPitch();

    const forward = this.getForward();
    const right = vec3.normalize(vec3.cross(forward, [0, 1, 0]));
    const worldUp: Vec3 = [0, 1, 0];
    const panStep = this.moveSpeed * dt * Math.max(this.distance * 0.35, 0.5);

    if (keys.has("w")) this.zoom(-120 * dt);
    if (keys.has("s")) this.zoom(120 * dt);
    if (keys.has("a")) this.target = vec3.add(this.target, vec3.scale(right, -panStep));
    if (keys.has("d")) this.target = vec3.add(this.target, vec3.scale(right, panStep));
    if (keys.has("q")) this.target = vec3.add(this.target, vec3.scale(worldUp, -panStep));
    if (keys.has("e")) this.target = vec3.add(this.target, vec3.scale(worldUp, panStep));

    this.syncPosition();
  }
}
