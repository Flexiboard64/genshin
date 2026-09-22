import * as THREE from 'three';
import type { CombatFx } from '../combat/types';

/**
 * Cibles gelées à faire fondre par les attaques Pyro (fontaine du village,
 * sceaux des monolithes). HP pyro, lueur de fissure progressive, vapeur,
 * éclatement final + callback de quête. Alimenté par Fireballs.onImpact et
 * PlayerCombat.onPyroAoe.
 */

const ICE = new THREE.Color(0x9fd8ff);

interface MatSnapshot {
  mat: THREE.MeshStandardMaterial;
  emissive: THREE.Color;
  intensity: number;
}

export interface MeltTargetState {
  id: string;
  object: THREE.Object3D;
  position: THREE.Vector3;
  radius: number;
  hp: number;
  hpMax: number;
  melted: boolean;
  meltT: number;
  dripT: number;
  mats: MatSnapshot[];
  onMelted: (t: MeltTargetState) => void;
}

export class MeltTargets {
  private readonly targets: MeltTargetState[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly fx: CombatFx) {}

  register(
    id: string,
    object: THREE.Object3D,
    position: THREE.Vector3,
    radius: number,
    hpMax: number,
    onMelted: (t: MeltTargetState) => void,
  ): MeltTargetState {
    const mats: MatSnapshot[] = [];
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        mats.push({
          mat: std,
          emissive: std.emissive.clone(),
          intensity: std.emissiveIntensity,
        });
      }
    });
    const state: MeltTargetState = {
      id,
      object,
      position: position.clone(),
      radius,
      hp: hpMax,
      hpMax,
      melted: false,
      meltT: 0,
      dripT: 0,
      mats,
      onMelted,
    };
    this.targets.push(state);
    return state;
  }

  get(id: string): MeltTargetState | undefined {
    return this.targets.find((t) => t.id === id);
  }

  /** Impact de boule de feu (rayon d'explosion ~2 m). */
  pyroHit(x: number, _y: number, z: number, dmg = 60): void {
    this.applyPyro(x, z, 2.2, dmg);
  }

  /** AoE pyro : toutes les cibles prises dans le rayon subissent les dégâts. */
  applyPyro(x: number, z: number, radius: number, dmg: number): void {
    for (const t of this.targets) {
      if (t.melted) continue;
      const dx = t.position.x - x;
      const dz = t.position.z - z;
      if (dx * dx + dz * dz > (t.radius + radius) ** 2) continue;
      t.hp = Math.max(0, t.hp - dmg);
      // Flash blanc-bleu à l'impact + vapeur
      this.fx.lights.flash(t.position.x, t.position.y + 0.8, t.position.z, 4, 0.25, 0xbfe4ff, 8);
      this.fx.particles.spawn(t.position.x, t.position.y + 0.6, t.position.z, 2, 6, {
        speed: 1.1, up: 2.2, spread: 0.7, life: [0.4, 0.9], size: [0.12, 0.3], color: 0xdff2ff,
      });
      if (t.hp <= 0) this.melt(t);
    }
  }

  private melt(t: MeltTargetState): void {
    t.melted = true;
    t.meltT = 0.8;
    const p = t.position;
    this.fx.particles.explosion(p.x, p.y + 0.7, p.z, 1.1);
    this.fx.particles.spawn(p.x, p.y + 0.5, p.z, 2, 26, {
      speed: 4.5, up: 3.5, spread: 1, life: [0.5, 1.1], size: [0.08, 0.22], color: ICE,
    });
    this.fx.lights.flash(p.x, p.y + 1, p.z, 9, 0.6, 0x9fd8ff, 14);
    this.fx.shake.add(0.2);
    t.onMelted(t);
  }

  update(dt: number, _elapsed: number): void {
    for (const t of this.targets) {
      // Lueur de fissure progressive (plus la glace perd de HP, plus elle rayonne)
      const crack = 1 - t.hp / t.hpMax;
      for (const s of t.mats) {
        s.mat.emissive.copy(s.emissive).lerp(ICE, crack * 0.55);
        s.mat.emissiveIntensity = s.intensity + crack * 0.9;
      }
      if (t.melted) {
        // Affaissement + disparition de la carapace de glace
        if (t.meltT > 0) {
          t.meltT -= dt;
          const k = Math.max(t.meltT / 0.8, 0);
          t.object.scale.y = Math.max(k, 0.04);
          t.object.position.y = t.position.y - (1 - k) * 0.15;
          if (t.meltT <= 0) t.object.visible = false;
        }
        continue;
      }
      // Gouttes de fonte quand la glace est entamée
      if (crack > 0.15) {
        t.dripT -= dt;
        if (t.dripT <= 0) {
          t.dripT = 0.5 - crack * 0.3;
          this.tmp.set(
            t.position.x + (Math.random() - 0.5) * t.radius,
            t.position.y + 0.25,
            t.position.z + (Math.random() - 0.5) * t.radius,
          );
          this.fx.particles.spawn(this.tmp.x, this.tmp.y, this.tmp.z, 0, 1, {
            speed: 0.3, up: 0.4, spread: 0.2, life: [0.3, 0.6], size: [0.05, 0.1], color: 0xcfeaff,
          });
        }
      }
    }
  }
}
