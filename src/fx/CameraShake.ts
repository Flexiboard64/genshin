import * as THREE from 'three';

/**
 * Camera shake à trauma : add() cumule, décroît linéairement, amplitude = trauma².
 * Appliqué après la mise à jour de la caméra orbitale (offsets position + rotation,
 * bruit lisse par sinus déphasés — aucune allocation).
 */
export class CameraShake {
  private trauma = 0;
  private time = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  get active(): boolean {
    return this.trauma > 0.001;
  }

  update(dt: number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
  }

  apply(camera: THREE.PerspectiveCamera): void {
    if (this.trauma <= 0.001) return;
    const s = this.trauma * this.trauma;
    const t = this.time;
    const nx = Math.sin(t * 61.7) * 0.6 + Math.sin(t * 127.3) * 0.4;
    const ny = Math.sin(t * 53.1 + 1.7) * 0.6 + Math.sin(t * 111.9 + 0.4) * 0.4;
    const nr = Math.sin(t * 71.3 + 3.1);
    camera.position.x += nx * 0.22 * s;
    camera.position.y += ny * 0.18 * s;
    camera.rotation.z += nr * 0.02 * s;
    camera.rotation.x += ny * 0.014 * s;
  }
}
