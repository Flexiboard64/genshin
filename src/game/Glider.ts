import * as THREE from 'three';
import type { Player } from './Player';
import type { CombatFx } from './combat/types';

/**
 * Planage façon Genshin : courants ascendants (updrafts) et anneaux-checkpoint.
 * Le physique du vol est dans Player.ts ; ce module fournit le décor des
 * courants (colonne de particules ascendantes), la poussée verticale quand le
 * joueur plane dedans, et les anneaux toriques additifs à traverser.
 */

const UPDRAFT_LIFT = 5.2; // m/s de poussée dans un courant
const RING_RADIUS = 3.2;
const GOLD = new THREE.Color(0xffd97a);

export interface Updraft {
  x: number;
  z: number;
  r: number;
  top: number; // hauteur max de poussée
  base: number; // y du sol
}

export interface GlideRing {
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  passed: boolean;
  seed: number;
}

export class Glider {
  readonly group = new THREE.Group();
  private readonly updrafts: Updraft[] = [];
  private readonly rings: GlideRing[] = [];
  private emitT = 0;
  /** Appelé quand un anneau est franchi (index, total franchis). */
  onRing: ((index: number, count: number) => void) | null = null;

  constructor(private readonly fx: CombatFx) {}

  /** Ajoute un courant ascendant visible (colonne de particules). */
  addUpdraft(x: number, z: number, r: number, base: number, top: number): void {
    this.updrafts.push({ x, z, r, base, top });
  }

  /** Ajoute un anneau checkpoint à la position donnée (face à la route). */
  addRing(position: THREE.Vector3, yaw: number): void {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(RING_RADIUS, 0.16, 10, 40),
      new THREE.MeshBasicMaterial({
        color: GOLD,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.position.copy(position);
    mesh.rotation.y = yaw;
    mesh.renderOrder = 7;
    this.group.add(mesh);
    this.rings.push({ position: position.clone(), mesh, passed: false, seed: Math.random() * 7 });
  }

  get passedCount(): number {
    return this.rings.reduce((n, r) => n + (r.passed ? 1 : 0), 0);
  }

  /** Remet les anneaux à zéro (rejouer le parcours). */
  resetRings(): void {
    for (const r of this.rings) {
      r.passed = false;
      r.mesh.visible = true;
    }
  }

  update(dt: number, elapsed: number, player: Player): void {
    // Courants ascendants : poussée si le joueur plane dans le cylindre
    player.glideLift = 0;
    if (player.gliding) {
      const p = player.position;
      for (const u of this.updrafts) {
        const dx = p.x - u.x;
        const dz = p.z - u.z;
        if (dx * dx + dz * dz < u.r * u.r && p.y > u.base - 1 && p.y < u.top) {
          player.glideLift = UPDRAFT_LIFT;
          break;
        }
      }
    }

    // Émission continue de particules dans les colonnes
    this.emitT += dt;
    if (this.emitT > 0.09) {
      this.emitT = 0;
      for (const u of this.updrafts) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * u.r * 0.8;
        this.fx.particles.spawn(
          u.x + Math.cos(a) * rr,
          u.base + Math.random() * 1.5,
          u.z + Math.sin(a) * rr,
          4,
          1,
          {
            speed: 0.3,
            up: 7 + Math.random() * 3,
            spread: 0.3,
            life: [1.2, 2.2],
            size: [0.1, 0.24],
            color: 0xbfe8ff,
          },
        );
      }
    }

    // Anneaux : rotation lente + détection de franchissement
    const p = player.position;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (r.passed) continue;
      r.mesh.rotation.z += dt * 0.6;
      const s = 1 + 0.06 * Math.sin(elapsed * 3 + r.seed);
      r.mesh.scale.setScalar(s);
      if (!player.gliding) continue;
      if (p.distanceToSquared(r.position) < RING_RADIUS * RING_RADIUS * 1.15) {
        r.passed = true;
        r.mesh.visible = false;
        this.fx.particles.spawn(r.position.x, r.position.y, r.position.z, 5, 18, {
          speed: 3, up: 0.5, spread: 1, life: [0.4, 0.9], size: [0.07, 0.18], color: GOLD,
        });
        this.fx.lights.flash(r.position.x, r.position.y, r.position.z, 6, 0.5, 0xffd97a, 10);
        this.onRing?.(i, this.passedCount);
      }
    }
  }
}
