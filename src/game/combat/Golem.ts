import * as THREE from 'three';
import { SkinnedEnemy } from './SkinnedEnemy';
import type { EnemyConfig, EnemyUpdateCtx } from './Enemy';
import { PYRO_DEEP } from '../../fx/Particles';

const GOLEM_CONFIG: EnemyConfig = {
  name: 'Gardien de pierre',
  level: 10,
  maxHp: 4200,
  speed: 2.0,
  aggroRange: 14,
  attackRange: 7,
  attackDamage: 620,
  attackCooldown: 3.6,
  radius: 1.25,
  barHeight: 4.6,
  knockbackResist: 1.0, // boss : immunisé au knockback
  hitDelay: 1.15,
};

const GOLEM_CRYO_CONFIG: EnemyConfig = {
  ...GOLEM_CONFIG,
  name: 'Gardien de Givre',
  level: 14,
  maxHp: 6200,
  attackDamage: 720,
};

const CRYO_DEEP = new THREE.Color(0.35, 0.72, 1.0);

const SLAM_RADIUS = 4.4;
const SLAM_DAMAGE = 620;
const SWIPE_DAMAGE = 480;
const SWIPE_RANGE = 3.6;

/**
 * Boss golem : coup de balayage au corps-à-corps, et à mi-distance un slam
 * télégraphié (cercle rouge) suivi d'une onde de choc + cratère + shake.
 * Résistant : pas de stagger, pas de knockback.
 * Variante cryo (quête « Le Cœur de l'Hiver ») : palette givrée + dégâts accrus.
 */
export class Golem extends SkinnedEnemy {
  private slamMode = false;
  private readonly slamTarget = new THREE.Vector3();
  private swipeTime = 1.2;
  private slamTime = 2.0;
  private readonly cryo: boolean;
  private readonly fxColor: THREE.Color;

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], cryo = false) {
    super(cryo ? GOLEM_CRYO_CONFIG : GOLEM_CONFIG, model, clips);
    this.cryo = cryo;
    this.fxColor = cryo ? CRYO_DEEP : PYRO_DEEP;
    if (this.anim.has('swipe')) this.swipeTime = this.anim.duration('swipe') / 1.05;
    if (this.anim.has('slam')) this.slamTime = this.anim.duration('slam') / 1.0;
    if (cryo) {
      this.applyCryoPalette();
      // Re-mémorise les matériaux APRÈS la palette : sinon le flash de dégât
      // restaurerait l'emissive d'origine et tuerait la lueur au premier coup.
      this.cacheMaterials(this.object);
    }
  }

  /** Teinte givrée + lueur cyan portée par la texture de base (recette Slime). */
  private applyCryoPalette(): void {
    const ICE = new THREE.Color(0.62, 0.82, 1.0);
    this.object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        std.color.lerp(ICE, 0.4);
        if (std.map) std.emissiveMap = std.map;
        std.emissive.copy(ICE).multiplyScalar(0.32);
        std.envMapIntensity = 0.55;
      }
    });
  }

  protected override get attackDuration(): number {
    return this.slamMode ? this.slamTime : this.swipeTime;
  }

  protected override onAttackStart(ctx: EnemyUpdateCtx): void {
    const dist = this.distanceTo(ctx.playerPos);
    this.slamMode = dist > SWIPE_RANGE * 0.9;
    if (this.slamMode) {
      // Le slam vise la position actuelle du joueur (esquivable, fidèle Genshin)
      this.slamTarget.copy(ctx.playerPos);
      ctx.fx.decals.telegraph(this.slamTarget.x, this.slamTarget.z, SLAM_RADIUS, this.config.hitDelay);
      this.playCombat('slam', 1.0);
    } else {
      this.playCombat('swipe', 1.05);
    }
  }

  protected override applyAttackHit(ctx: EnemyUpdateCtx): void {
    const fx = ctx.fx;
    if (this.slamMode) {
      // Impact de zone : onde de choc, cratère, débris, lumière, shake
      const t = this.slamTarget;
      const gy = ctx.groundAt(t.x, t.z);
      fx.decals.shockwave(t.x, t.z, SLAM_RADIUS * 1.5, 0.7, this.fxColor);
      fx.decals.scorch(t.x, t.z, SLAM_RADIUS * 0.75, 9);
      fx.particles.explosion(t.x, gy + 0.2, t.z, 1.3);
      fx.lights.flash(t.x, gy + 1, t.z, 9, 0.5, this.cryo ? 0x7fd4ff : 0xff5a20, 18);
      fx.shake.add(0.55);
      fx.hitstop(0.05, 0.25);
      if (ctx.playerAlive) {
        const d = Math.hypot(ctx.playerPos.x - t.x, ctx.playerPos.z - t.z);
        if (d <= SLAM_RADIUS) ctx.onPlayerHit(SLAM_DAMAGE, t.x, t.z);
      }
    } else {
      if (ctx.playerAlive && this.distanceTo(ctx.playerPos) <= SWIPE_RANGE * 1.3) {
        ctx.onPlayerHit(SWIPE_DAMAGE, this.object.position.x, this.object.position.z);
      }
      const p = this.object.position;
      const fxDir = Math.sin(this.object.rotation.y);
      const fzDir = Math.cos(this.object.rotation.y);
      fx.particles.spawn(p.x + fxDir * 2, p.y + 1, p.z + fzDir * 2, 0, 18, {
        speed: 7, up: 2, spread: 0.7, life: [0.2, 0.45], size: [0.06, 0.14],
        dirX: fxDir, dirZ: fzDir, color: this.fxColor,
      });
      fx.shake.add(0.22);
    }
  }
}
