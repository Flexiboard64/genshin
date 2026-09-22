import * as THREE from 'three';

const BLEND_IN = 0.55;
const SHOT_DIST = 2.45;
const PUSH_IN = 0.4;
const PUSH_IN_TIME = 14;
const SIDE_ANGLE = 0.68;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Plan cinématique de dialogue façon Genshin : à l'ouverture, la caméra glisse
 * (~0,55 s) vers un plan 3/4 rapproché sur l'interlocuteur, côté le plus
 * proche de la caméra de jeu ; travelling d'approche très lent ensuite. À la
 * fermeture, le boot redonne la main à ThirdPersonCamera (syncFromCamera).
 */
export class DialogueCamera {
  private active = false;
  private blend = 0;
  private time = 0;
  private sideAngle = 0;
  private readonly focus = new THREE.Vector3();
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private readonly targetPos = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly mat = new THREE.Matrix4();
  private readonly targetQuat = new THREE.Quaternion();

  get isActive(): boolean {
    return this.active;
  }

  /** focus = tête de l'interlocuteur ; playerPos = position du joueur. */
  begin(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, playerPos: THREE.Vector3): void {
    this.active = true;
    this.blend = 0;
    this.time = 0;
    this.focus.copy(focus);
    this.fromPos.copy(camera.position);
    this.fromQuat.copy(camera.quaternion);

    const base = Math.atan2(playerPos.x - focus.x, playerPos.z - focus.z);
    // Côté de plan : celui dont la position cible est la plus proche de la
    // caméra actuelle (trajet le plus court = transition la plus naturelle).
    let bestA = base + SIDE_ANGLE;
    let bestD = Infinity;
    for (const sign of [1, -1]) {
      const a = base + SIDE_ANGLE * sign;
      const dx = focus.x + Math.sin(a) * SHOT_DIST - camera.position.x;
      const dz = focus.z + Math.cos(a) * SHOT_DIST - camera.position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestA = a;
      }
    }
    this.sideAngle = bestA;
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    groundAt?: (x: number, z: number) => number,
  ): void {
    if (!this.active) return;
    this.time += dt;
    this.blend = Math.min(1, this.blend + dt / BLEND_IN);
    const e = this.blend * this.blend * (3 - 2 * this.blend);

    const dist = SHOT_DIST - PUSH_IN * Math.min(1, this.time / PUSH_IN_TIME);
    this.targetPos.set(
      this.focus.x + Math.sin(this.sideAngle) * dist,
      this.focus.y + 0.14,
      this.focus.z + Math.cos(this.sideAngle) * dist,
    );
    if (groundAt) {
      const minY = groundAt(this.targetPos.x, this.targetPos.z) + 0.32;
      if (this.targetPos.y < minY) this.targetPos.y = minY;
    }
    camera.position.lerpVectors(this.fromPos, this.targetPos, e);

    this.lookTarget.set(this.focus.x, this.focus.y - 0.06, this.focus.z);
    this.mat.lookAt(camera.position, this.lookTarget, UP);
    this.targetQuat.setFromRotationMatrix(this.mat);
    camera.quaternion.slerpQuaternions(this.fromQuat, this.targetQuat, e);
  }

  end(): void {
    this.active = false;
  }
}
