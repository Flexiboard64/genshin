import * as THREE from 'three';
import { SkinnedEnemy } from './SkinnedEnemy';
import type { EnemyConfig, EnemyUpdateCtx } from './Enemy';
import { CRYO_DEEP } from '../../fx/Particles';

const SKIRMISHER_CONFIG: EnemyConfig = {
  name: 'Tirailleur Fatui',
  level: 9,
  maxHp: 2300,
  speed: 3.1,
  aggroRange: 13,
  attackRange: 3.0,
  attackDamage: 560,
  attackCooldown: 3.0,
  radius: 0.65,
  barHeight: 2.2,
  knockbackResist: 0.75,
  hitDelay: 0.62,
};

/**
 * Tirailleur Fatui : soldat lourd à la lance — lent, tanky, grand coup
 * balayant avec onde de givre au sol.
 */
export class FatuiSkirmisher extends SkinnedEnemy {
  private attackTime = 1.35;

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    super(SKIRMISHER_CONFIG, model, clips);
    this.attackTime = this.anim.has('attack1') ? this.anim.duration('attack1') / 1.15 : 1.35;
  }

  protected override get attackDuration(): number {
    return this.attackTime;
  }

  protected override onAttackStart(_ctx: EnemyUpdateCtx): void {
    this.playCombat('attack1', 1.15);
  }

  protected override applyAttackHit(ctx: EnemyUpdateCtx): void {
    super.applyAttackHit(ctx);
    const p = this.object.position;
    const fx = Math.sin(this.object.rotation.y);
    const fz = Math.cos(this.object.rotation.y);
    ctx.fx.decals.shockwave(p.x + fx * 1.6, p.z + fz * 1.6, 2.4, 0.45, CRYO_DEEP);
    ctx.fx.particles.spawn(p.x + fx * 1.6, p.y + 0.2, p.z + fz * 1.6, 4, 14, {
      speed: 2.8, up: 2.4, spread: 1, life: [0.35, 0.8], size: [0.06, 0.14],
      color: CRYO_DEEP,
    });
  }
}
