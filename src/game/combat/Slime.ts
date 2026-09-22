import * as THREE from 'three';
import { Enemy, type EnemyConfig, type EnemyUpdateCtx } from './Enemy';
import type { CombatFx } from './types';
import { normalizeMeshyMaterials } from '../../core/materials';
import { PYRO, CRYO } from '../../fx/Particles';

const SLIME_CONFIG: EnemyConfig = {
  name: 'Slime Pyro',
  level: 3,
  maxHp: 320,
  speed: 3.4,
  aggroRange: 11,
  attackRange: 2.1,
  attackDamage: 220,
  attackCooldown: 3.1,
  radius: 0.55,
  barHeight: 1.25,
  knockbackResist: 0.1,
  hitDelay: 0.58,
};

export interface SlimeOpts {
  name: string;
  /** Lueur interne (emissive) + particules associées. */
  glow: THREE.Color;
  particle: THREE.Color;
}

/** Variante Cryo (Snezhnaya) : mêmes mouvements, palette givrée. */
export const SLIME_CRYO_OPTS: SlimeOpts = {
  name: 'Slime Cryo',
  glow: new THREE.Color(0.45, 0.8, 1.0),
  particle: CRYO,
};

const MODEL_HEIGHT = 0.95;
const WHITE = new THREE.Color(1, 1, 1);
const LEAP_HEIGHT = 1.5;

/**
 * Slime : pas de rig — rebond procédural avec squash & stretch,
 * attaque = grand bond retombant sur le joueur, traînée de particules élémentaires.
 */
export class Slime extends Enemy {
  private readonly visual = new THREE.Group();
  private hopPhase = Math.random() * Math.PI * 2;
  private squash = 0;
  private emberTimer = 0;
  private readonly coreMats: THREE.MeshStandardMaterial[] = [];
  private readonly opts: SlimeOpts;

  constructor(model: THREE.Object3D, opts?: SlimeOpts) {
    const o = opts ?? { name: SLIME_CONFIG.name, glow: new THREE.Color(1, 0.42, 0.12), particle: PYRO };
    super({ ...SLIME_CONFIG, name: o.name });
    this.opts = o;
    const box = new THREE.Box3().setFromObject(model);
    const height = Math.max(box.max.y - box.min.y, 0.01);
    const scale = MODEL_HEIGHT / height;
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false;
      }
    });
    normalizeMeshyMaterials(model);
    // Lueur interne élémentaire (braise Pyro / givre Cryo) : la texture de base
    // s'auto-éclaire (lisibilité crépusculaire) teintée de la couleur élémentaire
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
        std.emissive.copy(this.opts.glow).lerp(WHITE, 0.45);
        std.emissiveIntensity = 0.48;
        this.coreMats.push(std);
      }
    });
    // Après le glow pour que le flash de dégât restaure l'emissive correct
    this.cacheMaterials(model);
    this.visual.add(model);
    this.object.add(this.visual);
  }

  private get hopping(): boolean {
    return this.state === 'chase' || this.state === 'patrol' || this.state === 'return';
  }

  protected override get attackDuration(): number {
    return 1.0;
  }

  protected override onAttackStart(_ctx: EnemyUpdateCtx): void {
    this.squash = 0.5; // compression avant le bond
  }

  protected override applyAttackHit(ctx: EnemyUpdateCtx): void {
    super.applyAttackHit(ctx);
    // Retombée : petit cercle d'impact + particules élémentaires
    const p = this.object.position;
    ctx.fx.decals.shockwave(p.x, p.z, 1.8, 0.4, this.opts.particle);
    ctx.fx.particles.spawn(p.x, p.y + 0.15, p.z, 1, 12, {
      speed: 2.2, up: 2, spread: 1, life: [0.4, 0.9], size: [0.05, 0.11], color: this.opts.particle,
    });
    this.squash = 1;
  }

  protected override onDeath(fx: CombatFx): void {
    const p = this.object.position;
    fx.particles.pop(p.x, p.y + 0.3, p.z, this.opts.particle, 46);
    fx.lights.flash(p.x, p.y + 0.5, p.z, 5, 0.3);
    this.object.visible = false; // éclatement immédiat (pas de glisse)
  }

  protected override onReset(): void {
    this.visual.position.y = 0;
    this.visual.scale.set(1, 1, 1);
  }

  protected tickVisual(dt: number, ctx: EnemyUpdateCtx): void {
    // Attaque = bond parabolique vers le haut puis retombée
    if (this.attackAnimT >= 0) {
      const t = Math.min(this.attackAnimT / this.config.hitDelay, 1);
      if (t < 1) {
        this.visual.position.y = Math.sin(t * Math.PI * 0.5) * LEAP_HEIGHT;
      } else {
        const land = Math.min((this.attackAnimT - this.config.hitDelay) / 0.18, 1);
        this.visual.position.y = LEAP_HEIGHT * (1 - land);
      }
    } else if (this.hopping) {
      // Rebond de locomotion : |sin| avec écrasement à l'atterrissage
      this.hopPhase += dt * (this.state === 'chase' ? 8.2 : 5.2);
      const hop = Math.abs(Math.sin(this.hopPhase));
      this.visual.position.y = hop * (this.state === 'chase' ? 0.5 : 0.3);
      const landing = Math.max(0, Math.cos(this.hopPhase * 2));
      this.squash = Math.max(this.squash, landing * 0.4);
    } else {
      // Respiration gélatineuse au repos
      this.hopPhase += dt * 2.2;
      this.visual.position.y = 0;
      this.squash = Math.max(this.squash, 0.08 + 0.06 * Math.sin(this.hopPhase));
    }

    this.squash = Math.max(0, this.squash - dt * 3.2);
    const sy = 1 - this.squash * 0.38;
    const sxz = 1 + this.squash * 0.26;
    this.visual.scale.set(sxz, sy, sxz);

    // Pulsation de la braise interne (borne haute : le flash de dégât passe au-dessus)
    const pulse = 0.38 + 0.16 * Math.sin(ctx.elapsed * 5 + this.hopPhase);
    for (const m of this.coreMats) {
      if (m.emissiveIntensity > 0 && m.emissiveIntensity < 0.75) m.emissiveIntensity = pulse;
    }

    // Traînée élémentaire en poursuite
    if (this.state === 'chase') {
      this.emberTimer -= dt;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.22;
        const p = this.object.position;
        ctx.fx.particles.spawn(p.x, p.y + 0.3, p.z, 1, 2, {
          speed: 0.4, up: 1.2, spread: 0.5, life: [0.4, 0.8], size: [0.04, 0.09], color: this.opts.particle,
        });
      }
    }
  }
}
