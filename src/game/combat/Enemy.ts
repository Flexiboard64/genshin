import * as THREE from 'three';
import type { CombatFx } from './types';

export type EnemyState = 'idle' | 'patrol' | 'chase' | 'attack' | 'return' | 'hurt' | 'dead';

export interface EnemyConfig {
  name: string;
  level: number;
  maxHp: number;
  speed: number;
  aggroRange: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  /** Rayon de séparation entre ennemis. */
  radius: number;
  /** Hauteur d'affichage de la barre HP au-dessus de la tête. */
  barHeight: number;
  /** 0 = knockback complet, 1 = immunisé (boss). */
  knockbackResist: number;
  /** Délai entre le début de l'anim d'attaque et l'application des dégâts. */
  hitDelay: number;
}

export interface EnemyUpdateCtx {
  playerPos: THREE.Vector3;
  playerAlive: boolean;
  groundAt: (x: number, z: number) => number;
  fx: CombatFx;
  elapsed: number;
  onPlayerHit: (dmg: number, fromX: number, fromZ: number) => void;
}

const LEASH_RANGE = 30;
const DEAGGRO_RANGE = 22;
const HURT_STAGGER = 0.42;
const DEAD_SINK_DELAY = 1.5;
const DEAD_SINK_TIME = 1.4;

export abstract class Enemy {
  readonly object = new THREE.Group();
  readonly spawn = new THREE.Vector3();
  readonly config: EnemyConfig;
  hp: number;
  /** Camp dormant (embuscade de quête) : invisible et inerte jusqu'à activation. */
  dormant = false;
  /** Camp passif (gardes décoratifs) : n'aggro jamais le joueur. */
  passive = false;
  /** Pas de réapparition après la mort (camps de quête à déclenchement unique). */
  noRespawn = false;
  state: EnemyState = 'idle';
  aggroed = false;
  /** Dernière fois où le joueur a infligé des dégâts (affichage barre HP). */
  lastHurtAt = -999;
  deadAt = -999;

  protected heading = 0;
  protected attackTimer = 0;
  protected attackAnimT = -1; // temps écoulé dans l'anim d'attaque (-1 = pas d'attaque)
  protected hitApplied = false;
  protected hurtTimer = 0;
  protected readonly kbVel = new THREE.Vector3();
  protected patrolTarget = new THREE.Vector3();
  protected idleTimer = 0;
  private flashTimer = 0;
  private readonly flashMats: {
    mat: THREE.MeshStandardMaterial;
    baseEmissive: THREE.Color;
    baseIntensity: number;
  }[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(config: EnemyConfig) {
    this.config = config;
    this.hp = config.maxHp;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  setSpawn(x: number, y: number, z: number): void {
    this.spawn.set(x, y, z);
    this.object.position.copy(this.spawn);
  }

  /** Cache les matériaux pour le flash de dégât (mémorise l'emissive de base). */
  protected cacheMaterials(root: THREE.Object3D): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        this.flashMats.push({
          mat: std,
          baseEmissive: std.emissive.clone(),
          baseIntensity: std.emissiveIntensity,
        });
      }
    });
  }

  /** Point d'application des dégâts (centre du corps). */
  hurtPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.object.position.x, this.object.position.y + this.config.barHeight * 0.55, this.object.position.z);
  }

  distanceTo(p: THREE.Vector3): number {
    return Math.hypot(this.object.position.x - p.x, this.object.position.z - p.z);
  }

  /** Inflige des dégâts ; retourne true si l'ennemi meurt. */
  hurt(
    dmg: number,
    srcX: number,
    srcZ: number,
    knockback: number,
    fx: CombatFx,
    elapsed: number,
  ): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.lastHurtAt = elapsed;
    this.flashTimer = 0.13;
    this.aggroed = true;

    const resist = this.config.knockbackResist;
    if (knockback > 0 && resist < 1) {
      const dx = this.object.position.x - srcX;
      const dz = this.object.position.z - srcZ;
      const d = Math.max(Math.hypot(dx, dz), 0.01);
      const force = knockback * (1 - resist);
      this.kbVel.x += (dx / d) * force;
      this.kbVel.z += (dz / d) * force;
    }

    if (this.hp <= 0) {
      this.die(fx, elapsed);
      return true;
    }
    if (this.state !== 'dead' && this.config.knockbackResist < 0.9) {
      this.state = 'hurt';
      this.hurtTimer = HURT_STAGGER;
      this.attackAnimT = -1;
      this.onHurt();
    }
    return false;
  }

  protected die(fx: CombatFx, elapsed: number): void {
    this.state = 'dead';
    this.deadAt = elapsed;
    this.aggroed = false;
    this.attackAnimT = -1;
    this.kbVel.set(0, 0, 0);
    this.onDeath(fx);
  }

  /** Réapparition au point de spawn, PV pleins. */
  reset(groundAt: (x: number, z: number) => number): void {
    this.hp = this.config.maxHp;
    this.state = 'idle';
    this.aggroed = false;
    this.attackTimer = 0;
    this.attackAnimT = -1;
    this.hurtTimer = 0;
    this.kbVel.set(0, 0, 0);
    this.object.position.copy(this.spawn);
    this.object.position.y = groundAt(this.spawn.x, this.spawn.z);
    this.object.visible = true;
    this.object.scale.setScalar(1);
    this.onReset();
  }

  protected onHurt(): void {}
  protected onDeath(_fx: CombatFx): void {}
  protected onReset(): void {}

  /** Tick visuel spécifique (anims, squash&stretch) — appelé par update. */
  protected abstract tickVisual(dt: number, ctx: EnemyUpdateCtx): void;

  /** Dégâts de l'attaque appliqués si le joueur est encore à portée. */
  protected applyAttackHit(ctx: EnemyUpdateCtx): void {
    const reach = this.config.attackRange * 1.35;
    if (ctx.playerAlive && this.distanceTo(ctx.playerPos) <= reach) {
      ctx.onPlayerHit(this.config.attackDamage, this.object.position.x, this.object.position.z);
    }
  }

  protected faceToward(x: number, z: number, rate: number, dt: number): void {
    const target = Math.atan2(x - this.object.position.x, z - this.object.position.z);
    let delta = ((target - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.heading += delta * Math.min(1, rate * dt);
    this.object.rotation.y = this.heading;
  }

  protected moveToward(x: number, z: number, speed: number, dt: number, groundAt: (x: number, z: number) => number): void {
    const dx = x - this.object.position.x;
    const dz = z - this.object.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const step = Math.min(speed * dt, d);
    this.object.position.x += (dx / d) * step;
    this.object.position.z += (dz / d) * step;
    this.object.position.y = groundAt(this.object.position.x, this.object.position.z);
  }

  update(dt: number, ctx: EnemyUpdateCtx): void {
    const cfg = this.config;

    // Flash de dégât (emissive) — restaure l'emissive de base après le flash
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const on = this.flashTimer > 0;
      for (const f of this.flashMats) {
        if (on) {
          f.mat.emissive.setRGB(1, 0.85, 0.7);
          f.mat.emissiveIntensity = 0.75;
        } else {
          f.mat.emissive.copy(f.baseEmissive);
          f.mat.emissiveIntensity = f.baseIntensity;
        }
      }
    }

    // Knockback (tous états sauf mort)
    if (this.state !== 'dead' && (this.kbVel.x !== 0 || this.kbVel.z !== 0)) {
      this.object.position.x += this.kbVel.x * dt;
      this.object.position.z += this.kbVel.z * dt;
      const decay = Math.max(0, 1 - 7 * dt);
      this.kbVel.x *= decay;
      this.kbVel.z *= decay;
      if (Math.abs(this.kbVel.x) < 0.02) this.kbVel.x = 0;
      if (Math.abs(this.kbVel.z) < 0.02) this.kbVel.z = 0;
    }

    switch (this.state) {
      case 'idle': {
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) {
          this.idleTimer = 2.5 + Math.random() * 4;
          const a = Math.random() * Math.PI * 2;
          const r = 2 + Math.random() * 4;
          this.patrolTarget.set(this.spawn.x + Math.cos(a) * r, 0, this.spawn.z + Math.sin(a) * r);
          this.state = 'patrol';
        }
        break;
      }
      case 'patrol': {
        this.faceToward(this.patrolTarget.x, this.patrolTarget.z, 6, dt);
        this.moveToward(this.patrolTarget.x, this.patrolTarget.z, cfg.speed * 0.45, dt, ctx.groundAt);
        if (Math.hypot(this.patrolTarget.x - this.object.position.x, this.patrolTarget.z - this.object.position.z) < 0.4) {
          this.state = 'idle';
          this.idleTimer = 1.5 + Math.random() * 3;
        }
        break;
      }
      case 'chase': {
        this.faceToward(ctx.playerPos.x, ctx.playerPos.z, 8, dt);
        if (this.distanceTo(ctx.playerPos) > cfg.attackRange * 0.85) {
          this.moveToward(ctx.playerPos.x, ctx.playerPos.z, cfg.speed, dt, ctx.groundAt);
        }
        break;
      }
      case 'attack': {
        this.faceToward(ctx.playerPos.x, ctx.playerPos.z, 5, dt);
        break;
      }
      case 'return': {
        this.faceToward(this.spawn.x, this.spawn.z, 6, dt);
        this.moveToward(this.spawn.x, this.spawn.z, cfg.speed, dt, ctx.groundAt);
        if (Math.hypot(this.spawn.x - this.object.position.x, this.spawn.z - this.object.position.z) < 1) {
          this.state = 'idle';
          this.hp = Math.min(cfg.maxHp, this.hp + cfg.maxHp * 0.34);
        }
        break;
      }
      case 'hurt': {
        this.hurtTimer -= dt;
        if (this.hurtTimer <= 0) this.state = this.aggroed ? 'chase' : 'idle';
        break;
      }
      case 'dead': {
        // Glisse sous terre puis disparaît (le manager gère le respawn)
        const sinceDeath = ctx.elapsed - this.deadAt;
        if (sinceDeath > DEAD_SINK_DELAY) {
          this.object.position.y -= dt * 0.9;
          if (sinceDeath > DEAD_SINK_DELAY + DEAD_SINK_TIME) this.object.visible = false;
        }
        return; // pas d'IA, pas d'ancrage
      }
    }

    // Déclenchement / maintien de l'aggro (le cas 'dead' est déjà sorti plus haut)
    if (this.state !== 'hurt' && this.state !== 'return') {
      const distPlayer = this.distanceTo(ctx.playerPos);
      const distSpawn = Math.hypot(this.spawn.x - this.object.position.x, this.spawn.z - this.object.position.z);
      if (distSpawn > LEASH_RANGE) {
        this.state = 'return';
        this.aggroed = false;
        this.attackAnimT = -1;
      } else if (ctx.playerAlive && (this.aggroed || distPlayer < cfg.aggroRange)) {
        if (distPlayer > DEAGGRO_RANGE && this.aggroed && ctx.elapsed - this.lastHurtAt > 6) {
          this.state = 'return';
          this.aggroed = false;
        } else if (distPlayer < cfg.attackRange && this.attackTimer <= 0 && this.attackAnimT < 0) {
          this.state = 'attack';
          this.attackAnimT = 0;
          this.hitApplied = false;
          this.attackTimer = cfg.attackCooldown;
          this.onAttackStart(ctx);
        } else if (this.state !== 'attack' && distPlayer < DEAGGRO_RANGE) {
          this.state = 'chase';
          this.aggroed = true;
        }
      } else if (this.state === 'chase' || this.state === 'attack') {
        this.state = 'return';
        this.aggroed = false;
        this.attackAnimT = -1;
      }
    }

    // Progression de l'attaque en cours
    if (this.attackAnimT >= 0) {
      this.attackAnimT += dt;
      if (!this.hitApplied && this.attackAnimT >= cfg.hitDelay) {
        this.hitApplied = true;
        this.applyAttackHit(ctx);
      }
      if (this.attackAnimT >= this.attackDuration) {
        this.attackAnimT = -1;
        if (this.state === 'attack') this.state = this.aggroed ? 'chase' : 'idle';
      }
    }
    this.attackTimer -= dt;

    // Ancrage au terrain (sauf knockback aérien futur)
    this.object.position.y = ctx.groundAt(this.object.position.x, this.object.position.z);
    this.tmp.copy(this.object.position);
    this.tickVisual(dt, ctx);
  }

  /** Durée totale de l'anim d'attaque (secondes) — surchargé par les sous-classes. */
  protected get attackDuration(): number {
    return 1.1;
  }

  /** Hook : l'ennemi démarre son attaque (jouer l'anim). */
  protected onAttackStart(_ctx: EnemyUpdateCtx): void {}
}
