import * as THREE from "three";
import { damp, wrapAngle } from "./utils";

/**
 * Chase camera rigidly attached to the car along its axis — a positional
 * lerp would lag behind a 300 km/h car and make it drift up the frame, so
 * only the heading is smoothed (for a nice swing through corners).
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private smoothedHeading: number | null = null;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      0.5,
      3500,
    );
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  snapTo(x: number, z: number, heading: number) {
    this.smoothedHeading = heading;
    this.update(0.001, x, z, heading, 0);
  }

  update(dt: number, x: number, z: number, heading: number, speed: number) {
    if (this.smoothedHeading === null) this.smoothedHeading = heading;
    this.smoothedHeading +=
      wrapAngle(heading - this.smoothedHeading) * damp(7, dt);

    const fx = Math.sin(this.smoothedHeading);
    const fz = Math.cos(this.smoothedHeading);
    // fixed follow distance; at pace the camera rises a little and looks
    // further up the road, keeping the car low in the frame and close
    const dist = 6.9;
    const height = 3.2 + speed * 0.01;
    const ahead = 7 + speed * 0.04;

    this.camera.position.set(x - fx * dist, height, z - fz * dist);
    this.camera.lookAt(x + fx * ahead, 0.8, z + fz * ahead);
  }
}
