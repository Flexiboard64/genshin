import * as THREE from 'three';
import { Input } from '../core/Input';

const MOUSE_SENS_X = 0.0023;
const MOUSE_SENS_Y = 0.0021;
const PITCH_MIN = -1.1;
const PITCH_MAX = 1.25;
const DIST_MIN = 3.2;
const DIST_MAX = 8.5;
const FOCUS_HEIGHT = 1.55;

export class ThirdPersonCamera {
  yaw = Math.PI;
  pitch = 0.34;
  private distance = 5.6;
  private readonly current = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private initialized = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
  ) {}

  update(
    dt: number,
    focus: THREE.Vector3,
    groundAt: (x: number, z: number) => number,
  ): void {
    const { dx, dy } = this.input.consumeMouseDelta();
    this.yaw -= dx * MOUSE_SENS_X;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * MOUSE_SENS_Y, PITCH_MIN, PITCH_MAX);
    this.distance = THREE.MathUtils.clamp(
      this.distance + this.input.consumeWheel() * 0.6,
      DIST_MIN,
      DIST_MAX,
    );

    this.lookTarget.set(focus.x, focus.y + FOCUS_HEIGHT, focus.z);
    const cosPitch = Math.cos(this.pitch);
    this.desired.set(
      this.lookTarget.x + Math.sin(this.yaw) * cosPitch * this.distance,
      this.lookTarget.y + Math.sin(this.pitch) * this.distance,
      this.lookTarget.z + Math.cos(this.yaw) * cosPitch * this.distance,
    );

    const minY = groundAt(this.desired.x, this.desired.z) + 0.45;
    if (this.desired.y < minY) this.desired.y = minY;

    if (!this.initialized) {
      this.current.copy(this.desired);
      this.initialized = true;
    }
    this.current.lerp(this.desired, 1 - Math.exp(-16 * dt));
    this.camera.position.copy(this.current);
    this.camera.lookAt(this.lookTarget);
  }

  /**
   * Reprend la main en douceur après une caméra externe (plan de dialogue) :
   * l'état interne (position lissée + yaw/pitch) est recalé sur la pose
   * réelle de la caméra pour éviter tout saut au prochain update.
   */
  syncFromCamera(): void {
    this.current.copy(this.camera.position);
    this.camera.getWorldDirection(this.tmpForward);
    this.yaw = Math.atan2(-this.tmpForward.x, -this.tmpForward.z);
    this.pitch = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(-this.tmpForward.y, -1, 1)),
      PITCH_MIN,
      PITCH_MAX,
    );
    this.initialized = true;
  }
}
