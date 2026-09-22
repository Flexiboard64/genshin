import * as THREE from 'three';
import { SkinnedEnemy } from './SkinnedEnemy';
import type { EnemyConfig, EnemyUpdateCtx } from './Enemy';
import { normalizeMeshyMaterials } from '../../core/materials';
import { PYRO } from '../../fx/Particles';

const HILICHURL_CONFIG: EnemyConfig = {
  name: 'Hilichurl',
  level: 5,
  maxHp: 850,
  speed: 3.8,
  aggroRange: 13,
  attackRange: 2.3,
  attackDamage: 340,
  attackCooldown: 2.6,
  radius: 0.5,
  barHeight: 1.9,
  knockbackResist: 0.35,
  hitDelay: 0.55,
};

const CLUB_LENGTH = 0.85;

/** Hilichurl armé d'une massue : poursuite rapide, coup de massue temporisé. */
export class Hilichurl extends SkinnedEnemy {
  private attackTime = 1.1;

  constructor(
    model: THREE.Object3D,
    clips: THREE.AnimationClip[],
    club: THREE.Object3D | null,
  ) {
    super(HILICHURL_CONFIG, model, clips);
    this.attackTime = this.anim.has('attack1') ? this.anim.duration('attack1') / 1.2 : 1.1;

    if (club) {
      normalizeMeshyMaterials(club);
      const box = new THREE.Box3().setFromObject(club);
      const size = new THREE.Vector3();
      box.getSize(size);
      const longest = Math.max(size.x, size.y, size.z);
      const s = CLUB_LENGTH / Math.max(longest, 0.01);
      // Manche le long de l'axe le plus long → aligné avec la main
      if (size.y < size.x || size.y < size.z) club.rotation.z = Math.PI / 2;
      club.position.set(0.02, 0.04, 0);
      const attached = this.attachToBoneScaled(/hand.*(r|right)$|(r|right).*hand/i, club, s);
      if (!attached) {
        // Pas d'os trouvé : massue tenue statiquement à la hanche
        club.scale.setScalar(s);
        club.position.set(0.3, 0.8, 0.15);
        this.object.add(club);
      }
    }
  }

  protected override get attackDuration(): number {
    return this.attackTime;
  }

  protected override onAttackStart(_ctx: EnemyUpdateCtx): void {
    this.playCombat('attack1', 1.2);
  }

  protected override applyAttackHit(ctx: EnemyUpdateCtx): void {
    super.applyAttackHit(ctx);
    // Poussière du coup de massue au sol devant l'hilichurl
    const p = this.object.position;
    const fx = Math.sin(this.object.rotation.y);
    const fz = Math.cos(this.object.rotation.y);
    ctx.fx.particles.spawn(p.x + fx * 1.2, p.y + 0.15, p.z + fz * 1.2, 3, 8, {
      speed: 2.5, up: 2.5, spread: 0.8, life: [0.3, 0.6], size: [0.06, 0.14],
      color: PYRO,
    });
  }
}
