import * as THREE from 'three';
import type { AudioEngine } from '../core/AudioEngine';
import type { Player } from './Player';
import type { PlayerCombat } from './combat/PlayerCombat';
import type { Enemy } from './combat/Enemy';
import type { EnemyManager } from './combat/EnemyManager';

export interface GameSfxOptions {
  /** Base des variantes de pas : 'sfx-step-grass' (herbe) / 'sfx-step' (neige). */
  stepBase: string;
  /** Nombre de variantes de pas (`stepBase-1..n`). */
  stepCount: number;
  /** Nombre de variantes de brasses `sfx-swim-1..n` (0 = pas de nage ici). */
  swimCount?: number;
}

const STEP_DISTANCE = 2.4;
const SWIM_INTERVAL = 0.85;
const PLAYER_HURT_COOLDOWN = 0.5;
const ENEMY_HURT_COOLDOWN = 0.35;
const SHOT_FIRE_FRACTION = 0.3; // synchronisé avec SHOT_FIRE_AT (PlayerCombat)

/**
 * Câblage SFX partagé des deux mondes, par polling (zéro alloc dans la boucle :
 * états précédents en membres/Maps réutilisées). Couvre pas, saut, nage,
 * sorts E/Q, tirs, dégâts joueur/ennemis, orbes, énergie pleine.
 * Les événements ponctuels (splash, mort d'ennemi, orbe) arrivent via les
 * méthodes publiques chaînées depuis les boots.
 */
export class GameSfx {
  private readonly audio: AudioEngine;
  private readonly opts: Required<GameSfxOptions>;
  private initialized = false;
  // Pas / nage
  private stepAcc = 0;
  private lastX = 0;
  private lastZ = 0;
  private swimAcc = 0;
  // Saut / atterrissage
  private wasGrounded = true;
  // Modes de combat
  private lastMode: string = 'none';
  private fireTimer = -1;
  private lastCast: 'castE' | 'castQ' | null = null;
  // HP / énergie joueur
  private lastHp = -1;
  private lastQReady = false;
  private playerHurtCd = 0;
  // Ennemis
  private readonly prevHp = new Map<Enemy, number>();
  private readonly prevState = new Map<Enemy, string>();
  private readonly enemyHurtCd = new Map<Enemy, number>();
  private readonly slamTimers = new Map<Enemy, number>();

  constructor(audio: AudioEngine, opts: GameSfxOptions) {
    this.audio = audio;
    this.opts = { swimCount: 0, ...opts };
  }

  /** Plongeon : volume ∝ force de l'impact. */
  onSplash(strength: number): void {
    const volume = 0.45 + 0.4 * Math.min(strength, 1.6);
    void this.audio.play('sfx-splash', { volume, pitchVar: 0.08 });
  }

  /** Orbe d'énergie ramassée. */
  onOrb(): void {
    void this.audio.play('sfx-orb', { volume: 0.65, pitchVar: 0.06 });
  }

  /** Mort d'un ennemi (chaînée depuis EnemyManager.onEnemyDied). */
  onEnemyDied(e: Enemy): void {
    void this.audio.play('sfx-enemy-die', {
      at: { x: e.position.x, z: e.position.z },
      listener: this.listenerPos,
      volume: 0.8,
      pitchVar: 0.08,
    });
  }

  /** Explosion AoE E/Q (chaînée depuis PlayerCombat.onPyroAoe). */
  pyroBlast(x: number, z: number): void {
    const key = this.lastCast === 'castQ' ? 'sfx-judgment-blast' : 'sfx-vortex-blast';
    this.lastCast = null;
    void this.audio.play(key, {
      at: { x, z },
      listener: this.listenerPos,
      volume: 0.85,
      pitchVar: 0.05,
    });
  }

  private listenerPos: THREE.Vector3 | undefined;

  /** Boucle principale : polling des états joueur/combat/ennemis. */
  update(
    dt: number,
    player: Player,
    playerCombat: PlayerCombat,
    enemies: EnemyManager,
    opts: { indoor?: boolean } = {},
  ): void {
    const pos = player.position;
    this.listenerPos = pos;
    if (!this.initialized) {
      this.initialized = true;
      this.lastX = pos.x;
      this.lastZ = pos.z;
      this.lastHp = playerCombat.hp;
      this.wasGrounded = player.isGrounded;
      return;
    }

    // ——— Pas (distance parcourue au sol) ———
    const dx = pos.x - this.lastX;
    const dz = pos.z - this.lastZ;
    this.lastX = pos.x;
    this.lastZ = pos.z;
    const moving = dx * dx + dz * dz > 1e-8;

    if (player.isSwimming) {
      this.stepAcc = 0;
      // ——— Brasses ———
      if (this.opts.swimCount > 0 && moving) {
        this.swimAcc += dt;
        if (this.swimAcc >= SWIM_INTERVAL) {
          this.swimAcc = 0;
          this.audio.playVariant('sfx-swim', this.opts.swimCount, { volume: 0.5, pitchVar: 0.1 });
        }
      } else {
        this.swimAcc = 0;
      }
    } else if (!player.gliding && player.isGrounded && moving) {
      this.swimAcc = 0;
      this.stepAcc += Math.hypot(dx, dz);
      if (this.stepAcc >= STEP_DISTANCE) {
        this.stepAcc = 0;
        this.audio.playVariant(this.opts.stepBase, this.opts.stepCount, {
          volume: opts.indoor ? 0.22 : 0.38,
          pitchVar: 0.12,
        });
      }
    } else {
      this.stepAcc = 0;
      this.swimAcc = 0;
    }

    // ——— Saut / atterrissage ———
    const grounded = player.isGrounded;
    if (grounded !== this.wasGrounded) {
      this.wasGrounded = grounded;
      if (!player.isSwimming) {
        if (!grounded && !player.gliding) {
          void this.audio.play('sfx-jump', { volume: 0.45, pitchVar: 0.08 });
        } else if (grounded) {
          void this.audio.play('sfx-land', { volume: 0.5, pitchVar: 0.1 });
        }
      }
    }

    // ——— Modes de combat : tir, charges E/Q ———
    const mode = playerCombat.modeName;
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      if (mode === 'shot') {
        this.fireTimer = playerCombat.modeDur * SHOT_FIRE_FRACTION;
      } else if (mode === 'castE') {
        this.lastCast = 'castE';
        void this.audio.play('sfx-vortex-charge', { volume: 0.75 });
      } else if (mode === 'castQ') {
        this.lastCast = 'castQ';
        void this.audio.play('sfx-judgment-rise', { volume: 0.8 });
      }
    }
    if (this.fireTimer > 0) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = -1;
        void this.audio.play('sfx-fire-cast', { volume: 0.6, pitchVar: 0.08 });
      }
    }

    // ——— HP / énergie joueur ———
    this.playerHurtCd -= dt;
    const hp = playerCombat.hp;
    if (hp < this.lastHp && this.playerHurtCd <= 0 && playerCombat.alive) {
      this.playerHurtCd = PLAYER_HURT_COOLDOWN;
      void this.audio.play('sfx-player-hurt', { volume: 0.55, pitchVar: 0.1 });
    }
    if (this.lastHp > 0 && hp <= 0) {
      void this.audio.play('sfx-player-die', { volume: 0.8 });
    }
    this.lastHp = hp;
    const qReady = playerCombat.qReady;
    if (qReady !== this.lastQReady) {
      this.lastQReady = qReady;
      if (qReady) void this.audio.play('sfx-energy-full', { volume: 0.7 });
    }

    // ——— Ennemis : coups subis, attaques, slams de golem ———
    for (const e of enemies.enemies) {
      const prevHp = this.prevHp.get(e);
      const prevState = this.prevState.get(e);
      if (prevHp === undefined || prevState === undefined) {
        this.prevHp.set(e, e.hp);
        this.prevState.set(e, e.state);
        continue;
      }

      const hurtCd = (this.enemyHurtCd.get(e) ?? 0) - dt;
      if (e.hp < prevHp && e.alive && hurtCd <= 0) {
        this.enemyHurtCd.set(e, ENEMY_HURT_COOLDOWN);
        const at = { x: e.position.x, z: e.position.z };
        if (/slime/i.test(e.config.name)) {
          void this.audio.play('sfx-slime-squish', { at, listener: pos, volume: 0.6, pitchVar: 0.12 });
        } else {
          this.audio.playVariant('sfx-hit', 2, { at, listener: pos, volume: 0.55, pitchVar: 0.1 });
        }
      } else {
        this.enemyHurtCd.set(e, Math.max(hurtCd, 0));
      }

      if (e.state === 'attack' && prevState !== 'attack') {
        void this.audio.play('sfx-enemy-attack', {
          at: { x: e.position.x, z: e.position.z },
          listener: pos,
          volume: 0.6,
          pitchVar: 0.1,
        });
        if (/golem|gardien/i.test(e.config.name)) {
          this.slamTimers.set(e, e.config.hitDelay);
        }
      }
      const slamT = this.slamTimers.get(e);
      if (slamT !== undefined) {
        const next = slamT - dt;
        if (next <= 0) {
          this.slamTimers.delete(e);
          void this.audio.play('sfx-golem-slam', {
            at: { x: e.position.x, z: e.position.z },
            listener: pos,
            volume: 0.9,
            pitchVar: 0.06,
          });
        } else {
          this.slamTimers.set(e, next);
        }
      }

      this.prevHp.set(e, e.hp);
      this.prevState.set(e, e.state);
    }
  }
}
