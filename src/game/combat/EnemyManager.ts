import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Enemy, type EnemyUpdateCtx } from './Enemy';
import { Slime, SLIME_CRYO_OPTS } from './Slime';
import { Hilichurl } from './Hilichurl';
import { Golem } from './Golem';
import { FatuiAgent } from './FatuiAgent';
import { FatuiSkirmisher } from './FatuiSkirmisher';
import { calibrateSkinnedModel } from './measureSkinned';
import type { CombatFx } from './types';
import { GOLD } from '../../fx/Particles';

const RESPAWN_DELAY = 30;
const ORB_POOL = 12;
const ORB_MAGNET_RANGE = 2.6;
const ORB_PICKUP_RANGE = 0.7;

export type EnemyKind =
  | 'slime'
  | 'slime-cryo'
  | 'hilichurl'
  | 'golem'
  | 'fatui-agent'
  | 'fatui-skirmisher';

export interface CampDef {
  kind: EnemyKind;
  x: number;
  z: number;
  count: number;
  spread: number;
  /** Les ennemis ignorent le joueur (gardes décoratifs). */
  passive?: boolean;
  /** Invisibles et inertes jusqu'à activateDormant() (embuscades de quête). */
  dormant?: boolean;
  /** Pas de réapparition 30 s après la mort. */
  noRespawn?: boolean;
  /** Variante de palette ('cryo' pour le golem → Gardien de Givre). */
  variant?: string;
}

const CAMPS: CampDef[] = [
  { kind: 'slime', x: 4, z: -22, count: 6, spread: 5 },
  { kind: 'hilichurl', x: 58, z: -15, count: 4, spread: 6 },
  { kind: 'golem', x: -64, z: -14, count: 1, spread: 0 },
];

interface Orb {
  mesh: THREE.Mesh;
  active: boolean;
  phase: number;
}

export interface EnemyManagerDeps {
  slime: GLTF | undefined;
  hilichurl: GLTF | undefined;
  golem: GLTF | undefined;
  club: GLTF | undefined;
  hilichurlClips: THREE.AnimationClip[];
  golemClips: THREE.AnimationClip[];
  slimeCryo?: GLTF | undefined;
  fatuiAgent?: GLTF | undefined;
  fatuiSkirmisher?: GLTF | undefined;
  fatuiAgentClips?: THREE.AnimationClip[];
  fatuiSkirmisherClips?: THREE.AnimationClip[];
  groundAt: (x: number, z: number) => number;
  waterLevel: number;
  renderer: THREE.WebGLRenderer;
  /** Remplace les camps par défaut (Mondstadt) — ex. camps Snezhnaya. */
  camps?: CampDef[];
}

/** Hauteurs rendues cibles (m) — fidélité Genshin (joueuse ≈ 1,6 m). */
const TARGET_HEIGHT: Partial<Record<EnemyKind, number>> = {
  hilichurl: 1.55,
  golem: 4.2,
  'fatui-agent': 1.78,
  'fatui-skirmisher': 1.95,
};

/**
 * Correction empirique post-calibration : la mesure visuelle échoue pour les
 * rigs Fatui (rendu noir en capture → repli squelette qui sous-estime ~25 %).
 * Échelle ET ancre multipliées ensemble pour garder les pieds au sol.
 */
const SCALE_BOOST: Partial<Record<EnemyKind, number>> = {
  'fatui-agent': 1.25,
  'fatui-skirmisher': 1.25,
};

export class EnemyManager {
  readonly enemies: Enemy[] = [];
  private readonly orbs: Orb[] = [];
  private readonly groundAt: (x: number, z: number) => number;
  private readonly waterLevel: number;

  /** Appelé quand un slime meurt (orbe d'énergie). */
  onEnemyDied?: (enemy: Enemy) => void;

  constructor(scene: THREE.Scene, deps: EnemyManagerDeps) {
    this.groundAt = deps.groundAt;
    this.waterLevel = deps.waterLevel;

    // Calibration des gabarits skinnés : la bbox statique des rigs Meshy ne
    // reflète pas le rendu (unités cm/m mélangées) → mesure du VRAI rendu
    // (render target ortho) sur le gabarit, héritée par tous les clones.
    const calibrationClips: Partial<Record<EnemyKind, THREE.AnimationClip[] | undefined>> = {
      hilichurl: deps.hilichurlClips,
      golem: deps.golemClips,
      'fatui-agent': deps.fatuiAgentClips,
      'fatui-skirmisher': deps.fatuiSkirmisherClips,
    };
    const calibrationModels: Partial<Record<EnemyKind, GLTF | undefined>> = {
      hilichurl: deps.hilichurl,
      golem: deps.golem,
      'fatui-agent': deps.fatuiAgent,
      'fatui-skirmisher': deps.fatuiSkirmisher,
    };
    for (const kind of Object.keys(TARGET_HEIGHT) as EnemyKind[]) {
      const gltf = calibrationModels[kind];
      const target = TARGET_HEIGHT[kind];
      if (!gltf || !target) continue;
      const ok = calibrateSkinnedModel(
        deps.renderer,
        gltf.scene,
        target,
        calibrationClips[kind] ?? undefined,
      );
      if (!ok) console.warn(`[Enemies] calibration ${kind} échouée — échelle par défaut`);
      const boost = SCALE_BOOST[kind];
      if (boost) {
        gltf.scene.scale.multiplyScalar(boost);
        gltf.scene.position.y *= boost;
      }
    }

    for (const camp of deps.camps ?? CAMPS) {
      for (let i = 0; i < camp.count; i++) {
        const enemy = this.spawnEnemy(camp.kind, deps, camp, i);
        if (!enemy) continue;
        scene.add(enemy.object);
        this.enemies.push(enemy);
      }
    }

    const orbGeo = new THREE.IcosahedronGeometry(0.13, 1);
    const orbMat = new THREE.MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < ORB_POOL; i++) {
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.orbs.push({ mesh, active: false, phase: Math.random() * Math.PI * 2 });
    }
  }

  private spawnEnemy(
    kind: EnemyKind,
    deps: EnemyManagerDeps,
    camp: CampDef,
    index: number,
  ): Enemy | null {
    const models: Partial<Record<EnemyKind, GLTF | undefined>> = {
      slime: deps.slime,
      'slime-cryo': deps.slimeCryo,
      hilichurl: deps.hilichurl,
      golem: deps.golem,
      'fatui-agent': deps.fatuiAgent,
      'fatui-skirmisher': deps.fatuiSkirmisher,
    };
    const gltf = models[kind];
    if (!gltf) {
      console.warn(`[Enemies] modèle ${kind} indisponible — camp ignoré`);
      return null;
    }
    const model = cloneSkeleton(gltf.scene) as THREE.Group;
    let enemy: Enemy;
    // Les clips sont PARTAGÉS (chaque instance a son propre mixer) : un
    // clone() perdrait userData.bottomCurve (courbe d'ancrage animé).
    if (kind === 'slime') {
      enemy = new Slime(model);
    } else if (kind === 'slime-cryo') {
      enemy = new Slime(model, SLIME_CRYO_OPTS);
    } else if (kind === 'hilichurl') {
      const club = deps.club ? (cloneSkeleton(deps.club.scene) as THREE.Group) : null;
      enemy = new Hilichurl(model, deps.hilichurlClips, club);
    } else if (kind === 'fatui-agent') {
      enemy = new FatuiAgent(model, deps.fatuiAgentClips ?? []);
    } else if (kind === 'fatui-skirmisher') {
      enemy = new FatuiSkirmisher(model, deps.fatuiSkirmisherClips ?? []);
    } else {
      enemy = new Golem(model, deps.golemClips, camp.variant === 'cryo');
    }

    enemy.passive = camp.passive ?? false;
    enemy.dormant = camp.dormant ?? false;
    enemy.noRespawn = camp.noRespawn ?? false;
    if (enemy.dormant) enemy.object.visible = false;

    // Placement autour du centre de camp (seedé par index), repli si dans l'eau
    const angle = (index / Math.max(camp.count, 1)) * Math.PI * 2 + camp.x * 0.7;
    const r = camp.spread * (0.4 + ((index * 0.37) % 0.6));
    let x = camp.x + Math.cos(angle) * r;
    let z = camp.z + Math.sin(angle) * r;
    // Repli seulement si vraiment immergé (< niveau d'eau - 0,4), vers le CENTRE du camp
    let guard = 0;
    while (this.groundAt(x, z) < this.waterLevel - 0.4 && guard++ < 24) {
      x += (camp.x - x) * 0.15;
      z += (camp.z - z) * 0.15;
    }
    enemy.setSpawn(x, this.groundAt(x, z), z);
    return enemy;
  }

  /** Réveille les camps dormants dont le centre est dans le rayon (embuscades). */
  activateDormant(x: number, z: number, radius: number): number {
    let n = 0;
    for (const e of this.enemies) {
      if (!e.dormant) continue;
      if (Math.hypot(e.spawn.x - x, e.spawn.z - z) > radius) continue;
      e.dormant = false;
      e.object.visible = true;
      n++;
    }
    return n;
  }

  /** Cible la plus proche pour le soft-lock (optionnellement dans un cône). */
  nearestTarget(
    pos: THREE.Vector3,
    maxDist: number,
    heading?: number,
    maxAngle?: number,
  ): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist;
    for (const e of this.enemies) {
      if (!e.alive || e.dormant) continue;
      const d = e.distanceTo(pos);
      if (d >= bestD) continue;
      if (heading !== undefined && maxAngle !== undefined) {
        const angleTo = Math.atan2(e.position.x - pos.x, e.position.z - pos.z);
        let delta = Math.abs(((angleTo - heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
        if (delta > maxAngle) continue;
      }
      best = e;
      bestD = d;
    }
    return best;
  }

  /** Dégâts de zone (attaques du joueur) : retourne le nombre d'ennemis touchés. */
  dealAoeDamage(
    x: number,
    z: number,
    radius: number,
    dmg: number,
    opts: {
      knockback: number;
      kind: 'physical' | 'pyro';
      fx: CombatFx;
      elapsed: number;
      critChance?: number;
    },
  ): { hits: number; killed: number } {
    let hits = 0;
    let killed = 0;
    const hurtPoint = new THREE.Vector3();
    for (const e of this.enemies) {
      if (!e.alive || e.dormant) continue;
      const d = Math.hypot(e.position.x - x, e.position.z - z);
      if (d > radius + e.config.radius) continue;
      const crit = Math.random() < (opts.critChance ?? 0.12);
      const amount = Math.round(dmg * (crit ? 1.8 : 1) * (0.92 + Math.random() * 0.16));
      e.hurtPoint(hurtPoint);
      opts.fx.damageNumber(hurtPoint.x, hurtPoint.y, hurtPoint.z, amount, opts.kind, crit);
      const died = e.hurt(amount, x, z, opts.knockback, opts.fx, opts.elapsed);
      hits++;
      if (died) {
        killed++;
        this.onEnemyDied?.(e);
        if (e.config.name === 'Slime Pyro' || e.config.name === 'Slime Cryo') this.spawnOrb(hurtPoint.x, hurtPoint.y, hurtPoint.z);
      }
    }
    return { hits, killed };
  }

  /** Aspiration du vortex E : tire les ennemis proches vers un point. */
  pullEnemies(x: number, z: number, radius: number, speed: number, dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive || e.config.knockbackResist >= 0.9) continue;
      const dx = x - e.position.x;
      const dz = z - e.position.z;
      const d = Math.hypot(dx, dz);
      if (d > radius || d < 0.6) continue;
      const step = Math.min(speed * dt, d - 0.5);
      e.position.x += (dx / d) * step;
      e.position.z += (dz / d) * step;
    }
  }

  private spawnOrb(x: number, y: number, z: number): void {
    const orb = this.orbs.find((o) => !o.active);
    if (!orb) return;
    orb.active = true;
    orb.mesh.visible = true;
    orb.mesh.position.set(x + (Math.random() - 0.5), y + 0.4, z + (Math.random() - 0.5));
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerAlive: boolean,
    fx: CombatFx,
    elapsed: number,
    onPlayerHit: (dmg: number, fromX: number, fromZ: number) => void,
    onOrbPickup: () => void,
  ): void {
    const ctx: EnemyUpdateCtx = {
      playerPos,
      playerAlive,
      groundAt: this.groundAt,
      fx,
      elapsed,
      onPlayerHit,
    };

    // Séparation pairwise (11 ennemis → trivial)
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive || a.dormant) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || b.dormant) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const minD = a.config.radius + b.config.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (minD - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.position.x -= nx * push;
          a.position.z -= nz * push;
          b.position.x += nx * push;
          b.position.z += nz * push;
        }
      }
    }

    for (const e of list) {
      if (e.dormant) continue;
      // Respawn (jamais pour les camps de quête one-shot)
      if (!e.alive && !e.object.visible && !e.noRespawn && elapsed - e.deadAt > RESPAWN_DELAY) {
        e.reset(this.groundAt);
        continue;
      }
      // LOD : gel complet au-delà de 90 m
      if (e.distanceTo(playerPos) > 90) continue;
      // Camps passifs (gardes) : le joueur est ignoré même s'il s'approche
      if (e.passive) {
        e.update(dt, { ...ctx, playerAlive: false });
        continue;
      }
      e.update(dt, ctx);
    }

    // Orbes d'énergie : flottement + aimant + ramassage
    for (const orb of this.orbs) {
      if (!orb.active) continue;
      orb.phase += dt * 3;
      const m = orb.mesh;
      m.rotation.y += dt * 4;
      const d = m.position.distanceTo(playerPos);
      if (d < ORB_PICKUP_RANGE + 0.35) {
        orb.active = false;
        m.visible = false;
        fx.particles.spawn(m.position.x, m.position.y, m.position.z, 0, 10, {
          speed: 2, up: 1.5, spread: 0.8, life: [0.25, 0.5], size: [0.05, 0.1], color: GOLD,
        });
        onOrbPickup();
      } else if (d < ORB_MAGNET_RANGE) {
        const targetY = playerPos.y + 1;
        m.position.x += (playerPos.x - m.position.x) * Math.min(1, 9 * dt);
        m.position.y += (targetY - m.position.y) * Math.min(1, 9 * dt);
        m.position.z += (playerPos.z - m.position.z) * Math.min(1, 9 * dt);
      } else {
        const groundY = this.groundAt(m.position.x, m.position.z);
        m.position.y = groundY + 0.55 + Math.sin(orb.phase) * 0.15;
      }
    }
  }
}
