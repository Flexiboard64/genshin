import * as THREE from 'three';
import { SkinnedEnemy } from './SkinnedEnemy';
import type { EnemyConfig, EnemyUpdateCtx } from './Enemy';
import { CRYO } from '../../fx/Particles';

const AGENT_CONFIG: EnemyConfig = {
  name: 'Agent Fatui',
  level: 8,
  maxHp: 1400,
  speed: 5.2,
  aggroRange: 14,
  attackRange: 2.4,
  attackDamage: 420,
  attackCooldown: 2.2,
  radius: 0.5,
  barHeight: 2.0,
  knockbackResist: 0.45,
  hitDelay: 0.42,
};

/**
 * Agent Fatui : assassin rapide à la dague — poursuite véloce, coup court
 * temporisé tôt dans l'animation, gerbe de givre à l'impact.
 */
export class FatuiAgent extends SkinnedEnemy {
  private attackTime = 0.95;

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    super(AGENT_CONFIG, model, clips);
    this.attackTime = this.anim.has('attack1') ? this.anim.duration('attack1') / 1.45 : 0.95;
  }

  protected override get attackDuration(): number {
    return this.attackTime;
  }

  protected override onAttackStart(_ctx: EnemyUpdateCtx): void {
    this.playCombat('attack1', 1.45);
  }

  protected override applyAttackHit(ctx: EnemyUpdateCtx): void {
    super.applyAttackHit(ctx);
    const p = this.object.position;
    const fx = Math.sin(this.object.rotation.y);
    const fz = Math.cos(this.object.rotation.y);
    ctx.fx.particles.spawn(p.x + fx * 1.1, p.y + 1.0, p.z + fz * 1.1, 3, 9, {
      speed: 3.2, up: 1.2, spread: 0.7, life: [0.25, 0.55], size: [0.05, 0.12],
      color: CRYO,
    });
  }
}
