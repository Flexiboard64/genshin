import * as THREE from 'three';
import type { Player } from '../Player';
import type { Input } from '../../core/Input';
import type { EnemyManager } from './EnemyManager';
import type { Fireballs } from './Fireballs';
import type { CombatFx } from './types';
import type { SwordTrail } from '../../fx/SwordTrail';
import { normalizeMeshyMaterials } from '../../core/materials';
import { PYRO, GOLD } from '../../fx/Particles';

export type Mode = 'none' | 'shot' | 'castE' | 'castQ' | 'hurt' | 'dead';

export interface PlayerCombatDeps {
  player: Player;
  input: Input;
  enemies: EnemyManager;
  fx: CombatFx;
  trail: SwordTrail;
  sword: THREE.Object3D | null;
  fireballs: Fireballs;
  groundAt: (x: number, z: number) => number;
  onHudDamageFlash: () => void;
  onDeathFade: (show: boolean) => void;
}

const HP_MAX = 10000;
const ENERGY_MAX = 60;
const COMBO_STATES = ['attack1', 'attack2', 'attack3'] as const;
const SHOT_TIMESCALE = 2.3; // gestes de lancer rapides (cadence catalyseur)
const SHOT_FIRE_AT = 0.3; // fraction du geste où la boule part
const SHOT_CHAIN_AT = 0.78; // enchaînement si clic maintenu
const SOFT_LOCK_RANGE = 26;
const SOFT_LOCK_ANGLE = 0.6;
const E_COOLDOWN = 6;
const E_DMG = 2400;
const E_RADIUS = 4.2;
const E_PULL_RADIUS = 5.5;
const Q_DMG = 6000;
const Q_RADIUS = 7.5;
const I_FRAMES = 0.8;

/**
 * Combat du joueur : combo épée 3 coups avec buffer + soft-lock, compétence E
 * (vortex ardent aspirant puis explosion), déchaînement Q (jugement flamboyant :
 * cercle runique, pilier de feu, onde de choc). HP/énergie, réactions, mort.
 */
export class PlayerCombat {
  hp = HP_MAX;
  energy = ENERGY_MAX * 0.5;
  /** Callback externe (fonte pyro des cibles de quête) sur les AoE E/Q. */
  onPyroAoe: ((x: number, z: number, radius: number) => void) | null = null;
  private mode: Mode = 'none';
  private modeT = 0;
  private modeDuration = 0;
  private comboStep = 0;
  private buffered = false;
  private hitDone = false;
  private eCooldown = 0;
  private iFrames = 0;
  private qStormT = 0;
  private deadFadeShown = false;
  private elapsed = 0;
  private readonly player: Player;
  private readonly input: Input;
  private readonly enemies: EnemyManager;
  private readonly fx: CombatFx;
  private readonly trail: SwordTrail;
  private readonly fireballs: Fireballs;
  private readonly groundAt: (x: number, z: number) => number;
  private readonly onHudDamageFlash: () => void;
  private readonly onDeathFade: (show: boolean) => void;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private aimTarget: import('./Enemy').Enemy | null = null;
  private swordTipLocal: THREE.Vector3 | null = null;
  private swordObj: THREE.Object3D | null = null;

  constructor(deps: PlayerCombatDeps) {
    this.player = deps.player;
    this.input = deps.input;
    this.enemies = deps.enemies;
    this.fx = deps.fx;
    this.trail = deps.trail;
    this.fireballs = deps.fireballs;
    this.groundAt = deps.groundAt;
    this.onHudDamageFlash = deps.onHudDamageFlash;
    this.onDeathFade = deps.onDeathFade;
    if (deps.sword) this.attachSword(deps.sword);
  }

  private attachSword(sword: THREE.Object3D): void {
    normalizeMeshyMaterials(sword);
    const box = new THREE.Box3().setFromObject(sword);
    const size = new THREE.Vector3();
    box.getSize(size);
    const longest = Math.max(size.x, size.y, size.z);
    if (longest < 0.01) return;
    const scale = 1.05 / longest;
    sword.scale.setScalar(scale);

    // Lame le long de l'axe le plus long, pointe vers le haut local de la main
    const wrap = new THREE.Group();
    wrap.add(sword);
    const center = new THREE.Vector3();
    box.getCenter(center);
    sword.position.sub(center); // centre du modèle à l'origine du wrap
    sword.position.y -= longest * 0.28; // garde dans la paume
    if (size.y < size.x || size.y < size.z) {
      wrap.rotation.z = -Math.PI / 2; // axe le plus long → +Y local
    }
    wrap.rotation.x = 0.25;

    const hand =
      this.player.findBone(/hand.*(r|right)$|(r|right).*hand$/i) ??
      this.player.findBone(/hand_r|righthand/i) ??
      this.player.findBone(/wrist.*(r|right)/i);
    if (hand) {
      hand.add(wrap);
      this.swordObj = wrap;
      this.swordTipLocal = new THREE.Vector3(0, 1.05 * 0.72, 0);
    } else {
      // Secours : épée dans le dos du modèle
      wrap.position.set(0.18, 1.05, -0.22);
      wrap.rotation.z = 2.6;
      this.player.object.add(wrap);
      this.swordObj = wrap;
      this.swordTipLocal = new THREE.Vector3(0, 1.05 * 0.72, 0);
    }
  }

  get alive(): boolean {
    return this.mode !== 'dead';
  }

  /** Mode courant (SFX, vérification headless). */
  get modeName(): Mode {
    return this.mode;
  }

  /** Temps écoulé dans le mode courant. */
  get modeTime(): number {
    return this.modeT;
  }

  /** Durée totale du mode courant. */
  get modeDur(): number {
    return this.modeDuration;
  }

  get hpMax(): number {
    return HP_MAX;
  }

  get eCooldownRatio(): number {
    return Math.max(0, this.eCooldown) / E_COOLDOWN;
  }

  get qReady(): boolean {
    return this.energy >= ENERGY_MAX;
  }

  get energyRatio(): number {
    return this.energy / ENERGY_MAX;
  }

  /** Un ennemi aggro à proximité → posture de combat. */
  private combatNearby(): boolean {
    for (const e of this.enemies.enemies) {
      if (e.alive && e.aggroed && e.distanceTo(this.player.position) < 14) return true;
    }
    return false;
  }

  addEnergy(amount: number): void {
    this.energy = Math.min(ENERGY_MAX, this.energy + amount);
  }

  heal(amount: number): void {
    this.hp = Math.min(HP_MAX, this.hp + amount);
    const p = this.player.position;
    this.fx.damageNumber(p.x, p.y + 1.5, p.z, amount, 'heal');
  }

  /** Dégâts subis (appelé par EnemyManager via onPlayerHit). */
  hurt = (dmg: number, fromX: number, fromZ: number): void => {
    if (this.mode === 'dead' || this.iFrames > 0 || this.mode === 'castQ') return;
    this.hp = Math.max(0, this.hp - dmg);
    this.iFrames = I_FRAMES;
    this.onHudDamageFlash();
    const p = this.player.position;
    this.fx.damageNumber(p.x, p.y + 1.4, p.z, dmg, 'playerHurt');
    this.fx.shake.add(0.3);
    // Projection légère
    const dx = p.x - fromX;
    const dz = p.z - fromZ;
    const d = Math.max(Math.hypot(dx, dz), 0.01);
    p.x += (dx / d) * 0.5;
    p.z += (dz / d) * 0.5;

    if (this.hp <= 0) {
      this.die();
      return;
    }
    // Poise Genshin : les coups/casts en cours ont de l'hyper-armure — dégâts
    // subis mais pas d'interruption. Stagger seulement au repos.
    if (this.mode === 'none' || this.mode === 'hurt') {
      this.mode = 'hurt';
      this.modeT = 0;
      this.trail.end();
      this.modeDuration =
        this.player.controller?.playOnce('hurt', { timeScale: 1.3, fade: 0.06 }) ?? 0.5;
    }
  };

  private die(): void {
    this.mode = 'dead';
    this.modeT = 0;
    this.deadFadeShown = false;
    this.trail.end();
    this.player.controller?.playOnce('dead', { fade: 0.15 });
  }

  /** Ramassage d'orbe (callback EnemyManager). */
  onOrbPickup = (): void => {
    this.addEnergy(8);
    this.heal(120);
  };

  // ——— Attaque normale : boule de feu (style catalyseur) ———

  private startShot(step: number): void {
    this.mode = 'shot';
    this.comboStep = step;
    this.modeT = 0;
    this.buffered = false;
    this.hitDone = false;
    const state = COMBO_STATES[step - 1];
    this.modeDuration =
      this.player.controller?.playOnce(state, { timeScale: SHOT_TIMESCALE, fade: 0.06 }) ?? 0;
    if (this.modeDuration <= 0) this.modeDuration = 0.45; // clip manquant : cadence de repli

    // Soft-lock longue portée : pivote vers la cible dans le cône de visée
    this.aimTarget = this.enemies.nearestTarget(
      this.player.position,
      SOFT_LOCK_RANGE,
      this.player.headingAngle,
      SOFT_LOCK_ANGLE,
    );
    if (this.aimTarget) {
      this.player.headingAngle = Math.atan2(
        this.aimTarget.position.x - this.player.position.x,
        this.aimTarget.position.z - this.player.position.z,
      );
    }
  }

  private fireShot(): void {
    const p = this.player.position;
    const heading = this.player.headingAngle;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    this.tmpA.set(p.x + fx * 0.55, p.y + 1.35, p.z + fz * 0.55);
    if (this.aimTarget && this.aimTarget.alive) {
      const t = this.aimTarget;
      this.tmpB.set(
        t.position.x,
        t.position.y + t.config.barHeight * 0.45,
        t.position.z,
      ).sub(this.tmpA);
    } else {
      // À défaut de cible : tir tendu dans la direction du regard
      this.tmpB.set(fx * 20, 1.2, fz * 20);
      this.aimTarget = null;
    }
    this.fireballs.fire(this.tmpA, this.tmpB, this.aimTarget);
  }

  // ——— Compétence E : vortex ardent ———

  private startCastE(): void {
    this.mode = 'castE';
    this.modeT = 0;
    this.hitDone = false;
    this.eCooldown = E_COOLDOWN;
    this.modeDuration =
      this.player.controller?.playOnce('castE', { timeScale: 1.15, fade: 0.1 }) ?? 1.2;
    const p = this.player.position;
    this.fx.decals.rune(p.x, p.z, 2.6, 1.1);
    this.fx.lights.flash(p.x, p.y + 1, p.z, 4, 0.5, 0xffa040, 9);
  }

  private applyEBlast(): void {
    const p = this.player.position;
    this.fx.particles.explosion(p.x, p.y + 0.3, p.z, 1.15);
    this.fx.decals.shockwave(p.x, p.z, E_RADIUS * 1.6, 0.5, PYRO);
    this.fx.decals.scorch(p.x, p.z, 2.6, 6);
    this.fx.lights.flash(p.x, p.y + 1.2, p.z, 10, 0.45, 0xff7a3c, 16);
    this.fx.shake.add(0.42);
    this.fx.hitstop(0.06, 0.1);
    const { hits } = this.enemies.dealAoeDamage(p.x, p.z, E_RADIUS, E_DMG, {
      knockback: 7.5,
      kind: 'pyro',
      fx: this.fx,
      elapsed: this.elapsed,
    });
    console.debug('[E] blast en', p.x.toFixed(1), p.z.toFixed(1), 'touchés:', hits);
    this.onPyroAoe?.(p.x, p.z, E_RADIUS);
    if (hits > 0) this.addEnergy(Math.min(8 * hits, 20));
  }

  // ——— Déchaînement Q : jugement flamboyant ———

  private startCastQ(): void {
    this.mode = 'castQ';
    this.modeT = 0;
    this.hitDone = false;
    this.energy = 0;
    this.modeDuration =
      this.player.controller?.playOnce('castQ', { timeScale: 1.1, fade: 0.12 }) ?? 2;
    const p = this.player.position;
    this.fx.decals.rune(p.x, p.z, 7, Math.min(this.modeDuration * 0.85, 2.4), GOLD);
    this.fx.lights.flash(p.x, p.y + 1.4, p.z, 7, this.modeDuration * 0.5, 0xffa040, 15);
    this.fx.shake.add(0.18);
  }

  private applyQBurst(): void {
    const p = this.player.position;
    const fx = this.fx;
    fx.particles.pillar(p.x, p.y, p.z, 1.4);
    fx.particles.explosion(p.x, p.y + 0.4, p.z, 1.9);
    fx.decals.shockwave(p.x, p.z, 12, 0.75, PYRO);
    fx.decals.scorch(p.x, p.z, 6.5, 12);
    fx.lights.flash(p.x, p.y + 2, p.z, 16, 0.7, 0xff8a30, 24);
    fx.shake.add(0.85);
    fx.hitstop(0.09, 0.05);
    this.qStormT = 0.9;
    const { hits } = this.enemies.dealAoeDamage(p.x, p.z, Q_RADIUS, Q_DMG, {
      knockback: 11,
      kind: 'pyro',
      fx,
      elapsed: this.elapsed,
      critChance: 0.2,
    });
    console.debug('[Q] burst en', p.x.toFixed(1), p.z.toFixed(1), 'touchés:', hits);
    this.onPyroAoe?.(p.x, p.z, Q_RADIUS);
    if (hits > 0) fx.hitstop(0.05, 0.12);
  }

  // ——— Boucle ———

  update(dt: number, elapsed: number): void {
    this.elapsed = elapsed;
    const player = this.player;
    const ctrl = player.controller;

    this.eCooldown = Math.max(0, this.eCooldown - dt);
    this.iFrames = Math.max(0, this.iFrames - dt);

    // Posture de combat au repos
    player.preferredIdle = this.combatNearby() && ctrl?.has('combatIdle') ? 'combatIdle' : 'idle';

    // La nage annule toute action en cours et ignore les entrées
    if (player.isSwimming) {
      if (this.mode === 'shot' || this.mode === 'castE' || this.mode === 'castQ') {
        this.mode = 'none';
        this.trail.end();
      }
      this.input.consumeAttack();
      this.input.consumeSkill();
      this.input.consumeBurst();
    }

    // ——— Entrées ———
    if (this.mode !== 'dead' && !player.isSwimming) {
      const clicked = this.input.consumeAttack();
      if ((clicked || this.input.attackHeld) && player.isGrounded) {
        if (this.mode === 'none') this.startShot(this.comboStep === 3 ? 1 : this.comboStep + 1);
        else if (this.mode === 'shot') this.buffered = true;
      }
      if (this.input.consumeSkill() && this.mode === 'none' && this.eCooldown <= 0 && player.isGrounded) {
        this.startCastE();
      }
      if (this.input.consumeBurst() && this.mode === 'none' && this.qReady && player.isGrounded) {
        this.startCastQ();
      }
    }

    // ——— Verrou de mouvement / d'animation ———
    const busy = this.mode !== 'none';
    player.movementLock = busy;
    player.animOverride = busy;

    if (this.mode === 'none') return;
    this.modeT += dt;
    const t = this.modeT / Math.max(this.modeDuration, 1e-3);

    switch (this.mode) {
      case 'shot': {
        if (!this.hitDone && t >= SHOT_FIRE_AT) {
          this.hitDone = true;
          this.fireShot();
        }
        if (this.buffered && t >= SHOT_CHAIN_AT) {
          this.startShot(this.comboStep === 3 ? 1 : this.comboStep + 1);
        } else if (t >= 1) {
          this.mode = 'none';
        }
        break;
      }
      case 'castE': {
        const chargeEnd = Math.min(0.55, 0.85 / this.modeDuration);
        if (t < chargeEnd) {
          // Aspiration + tourbillon de braises
          const p = player.position;
          this.enemies.pullEnemies(p.x, p.z, E_PULL_RADIUS, 4.5, dt);
          this.fx.particles.vortex(p.x, p.y + 0.25, p.z, 3.2, 3);
        } else if (!this.hitDone) {
          this.hitDone = true;
          this.applyEBlast();
        }
        if (t >= 1) this.mode = 'none';
        break;
      }
      case 'castQ': {
        if (!this.hitDone && t >= 0.52) {
          this.hitDone = true;
          this.applyQBurst();
        }
        if (t >= 1) this.mode = 'none';
        break;
      }
      case 'hurt': {
        if (t >= 1) this.mode = 'none';
        break;
      }
      case 'dead': {
        if (this.modeT > 1.3 && !this.deadFadeShown) {
          this.deadFadeShown = true;
          this.onDeathFade(true);
        }
        if (this.modeT > 2.6) {
          player.respawnAtLastSafe(this.groundAt);
          this.hp = Math.round(HP_MAX * 0.6);
          this.iFrames = 2;
          this.mode = 'none';
          this.onDeathFade(false);
          ctrl?.setState('idle', 0.1);
        }
        break;
      }
    }

    // Tempête de braises résiduelle après le Q
    if (this.qStormT > 0) {
      this.qStormT -= dt;
      const p = player.position;
      this.fx.particles.spawn(p.x, p.y + 0.4, p.z, 1, 5, {
        speed: 4.5, up: 3.5, spread: 1.6, life: [0.6, 1.4], size: [0.06, 0.16], color: PYRO,
      });
    }
  }

  // ——— Hooks de démonstration (vérification headless) ———
  debugAttack(): void {
    if (this.mode === 'none') this.startShot(1);
  }

  debugE(): void {
    if (this.mode !== 'dead') this.startCastE();
  }

  debugQ(): void {
    if (this.mode !== 'dead') {
      this.energy = ENERGY_MAX;
      this.startCastQ();
    }
  }
}
