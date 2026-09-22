import * as THREE from 'three';
import type { CombatFx } from '../combat/types';
import { makeFlame } from '../../fx/FlameMaterial';

/**
 * Les 4 braseros de Beryozka : éteints au départ, allumés par le Pyro du
 * joueur (boules de feu / E / Q). Chaque brasero allumé = flamme shader +
 * point light chaude + source de chaleur pour le froid mordant.
 */

export interface Brazier {
  position: THREE.Vector3;
  lit: boolean;
  flame: THREE.Mesh | null;
  light: THREE.PointLight | null;
  seed: number;
}

export class VillageBraziers {
  readonly braziers: Brazier[] = [];
  /** Appelé quand un brasero s'allume (index, nombre total allumés). */
  onLit: ((index: number, litCount: number) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    positions: readonly THREE.Vector3[],
    private readonly fx: CombatFx,
  ) {
    for (const p of positions) {
      this.braziers.push({
        position: p.clone(),
        lit: false,
        flame: null,
        light: null,
        seed: Math.random() * 100,
      });
    }
  }

  get litCount(): number {
    return this.braziers.reduce((n, b) => n + (b.lit ? 1 : 0), 0);
  }

  /** AoE pyro : allume les braseros éteints pris dans le rayon. */
  applyPyro(x: number, z: number, radius: number): void {
    for (let i = 0; i < this.braziers.length; i++) {
      const b = this.braziers[i];
      if (b.lit) continue;
      const dx = b.position.x - x;
      const dz = b.position.z - z;
      if (dx * dx + dz * dz > (radius + 0.9) ** 2) continue;
      this.ignite(i);
    }
  }

  private ignite(index: number): void {
    const b = this.braziers[index];
    b.lit = true;
    b.flame = makeFlame(1.05, b.seed);
    b.flame.position.set(b.position.x, b.position.y + 0.72, b.position.z);
    b.light = new THREE.PointLight(0xff9a3e, 30, 16, 1.8);
    b.light.position.set(b.position.x, b.position.y + 1.4, b.position.z);
    this.scene.add(b.flame, b.light);
    this.fx.particles.explosion(b.position.x, b.position.y + 0.8, b.position.z, 0.5);
    this.fx.lights.flash(b.position.x, b.position.y + 1, b.position.z, 7, 0.4, 0xffa040, 10);
    this.onLit?.(index, this.litCount);
  }

  update(dt: number, elapsed: number): void {
    for (const b of this.braziers) {
      if (!b.lit || !b.flame || !b.light) continue;
      (b.flame.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed;
      b.light.intensity = 26 + Math.sin(elapsed * 9 + b.seed) * 3 + Math.sin(elapsed * 23.7 + b.seed * 2) * 2;
      // Braises montantes
      if (Math.random() < dt * 2.2) {
        this.fx.particles.spawn(b.position.x, b.position.y + 0.9, b.position.z, 1, 1, {
          speed: 0.5, up: 1.6, spread: 0.25, life: [0.5, 1.1], size: [0.04, 0.09], color: 0xffa050,
        });
      }
    }
  }
}
