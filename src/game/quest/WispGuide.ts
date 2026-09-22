import * as THREE from 'three';
import type { CombatFx } from '../combat/types';

/**
 * Renard-esprit guide (étape forêt) : orbe cyan lumineux qui suit une spline
 * village → forêt → monolithes. Il avance tant que le joueur reste à moins de
 * FOLLOW_DIST, sinon il attend en flottant sur place. Traînée d'étincelles.
 */

const FOLLOW_DIST = 14;
const SPEED = 4.6;
const CYAN = new THREE.Color(0x7fd8ff);

export class WispGuide {
  readonly object = new THREE.Group();
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly light: THREE.PointLight;
  private readonly core: THREE.Mesh;
  private readonly shell: THREE.Mesh;
  private progress = 0; // distance parcourue sur la courbe
  private readonly length: number;
  active = false;
  arrived = false;
  /** Appelé une fois à l'arrivée au bout de la spline. */
  onArrived: (() => void) | null = null;
  private trailT = 0;
  private bob = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    waypoints: readonly THREE.Vector3[],
    private readonly fx: CombatFx,
  ) {
    this.curve = new THREE.CatmullRomCurve3([...waypoints], false, 'centripetal', 0.4);
    this.length = this.curve.getLength();

    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.85, 0.97, 1),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 14, 12),
      new THREE.MeshBasicMaterial({
        color: CYAN,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.light = new THREE.PointLight(0x6fd0ff, 14, 12, 1.9);
    this.light.position.y = 0.2;
    this.object.add(this.core, this.shell, this.light);
    this.object.visible = false;
    this.curve.getPointAt(0, this.object.position);
  }

  /** Position courante (cible de quête / minimap). */
  get position(): THREE.Vector3 {
    return this.object.position;
  }

  /** Démarre le guidage (depuis le début de la spline). */
  begin(): void {
    this.active = true;
    this.arrived = false;
    this.progress = 0;
    this.object.visible = true;
    this.curve.getPointAt(0, this.object.position);
  }

  hide(): void {
    this.active = false;
    this.object.visible = false;
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3): void {
    if (!this.active || this.arrived) return;
    this.bob += dt;

    // Avance si le joueur suit, sinon attend
    const dist = this.tmp.copy(this.object.position).sub(playerPos).length();
    if (dist < FOLLOW_DIST) {
      this.progress = Math.min(this.progress + SPEED * dt, this.length);
    }
    const u = this.progress / this.length;
    this.curve.getPointAt(u, this.object.position);
    this.object.position.y += 1.1 + Math.sin(this.bob * 2.1) * 0.25;

    // Pulsation + scintillement
    const pulse = 1 + 0.22 * Math.sin(elapsed * 6.3);
    this.shell.scale.setScalar(pulse);
    this.light.intensity = 12 + Math.sin(elapsed * 8.1) * 3;

    // Traînée d'étincelles
    this.trailT += dt;
    if (this.trailT > 0.05) {
      this.trailT = 0;
      this.fx.particles.spawn(this.object.position.x, this.object.position.y, this.object.position.z, 3, 1, {
        speed: 0.2, up: 0.1, spread: 0.25, life: [0.4, 0.9], size: [0.05, 0.12], color: CYAN,
      });
    }

    if (this.progress >= this.length) {
      this.arrived = true;
      // Envolets finaux
      this.fx.particles.spawn(this.object.position.x, this.object.position.y, this.object.position.z, 3, 22, {
        speed: 2.5, up: 2, spread: 1, life: [0.6, 1.3], size: [0.06, 0.16], color: CYAN,
      });
      this.fx.lights.flash(this.object.position.x, this.object.position.y, this.object.position.z, 8, 0.8, 0x7fd8ff, 12);
      this.onArrived?.();
    }
  }
}
