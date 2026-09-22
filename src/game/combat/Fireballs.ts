import * as THREE from 'three';
import type { EnemyManager, } from './EnemyManager';
import type { Enemy } from './Enemy';
import type { CombatFx } from './types';
import { PYRO, GOLD } from '../../fx/Particles';

/**
 * Boules de feu du clic gauche (style catalyseur Genshin) : projectiles poolés
 * avec léger homing vers la cible verrouillée, traînée de braises, flash de
 * bouche et explosion pyro à l'impact (dégâts de zone + nombre de dégâts).
 */

const POOL = 10;
const SPEED = 21;
const LIFE = 1.7;
const HOMING = 7.5; // 1/s — amorti exponentiel de la direction vers la cible
const HIT_RADIUS = 0.75;
const AOE_RADIUS = 1.9;
const DMG = 750;
const TRAIL_EVERY = 0.028;

interface Fireball {
  root: THREE.Group;
  core: THREE.Mesh;
  shell: THREE.Mesh;
  vel: THREE.Vector3;
  target: Enemy | null;
  active: boolean;
  age: number;
  trailT: number;
  seed: number;
}

export class Fireballs {
  private readonly balls: Fireball[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  /** Callback externe (fonte pyro des cibles de quête) à chaque explosion. */
  onImpact: ((x: number, y: number, z: number) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly enemies: EnemyManager,
    private readonly fx: CombatFx,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly onHits: (hits: number) => void,
  ) {
    const coreGeo = new THREE.SphereGeometry(0.1, 12, 10);
    const shellGeo = new THREE.SphereGeometry(0.24, 12, 10);
    for (let i = 0; i < POOL; i++) {
      const core = new THREE.Mesh(
        coreGeo,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(1, 0.93, 0.78),
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const shell = new THREE.Mesh(
        shellGeo,
        new THREE.MeshBasicMaterial({
          color: PYRO,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const root = new THREE.Group();
      root.add(core, shell);
      root.visible = false;
      root.renderOrder = 7;
      scene.add(root);
      this.balls.push({
        root,
        core,
        shell,
        vel: new THREE.Vector3(),
        target: null,
        active: false,
        age: 0,
        trailT: 0,
        seed: Math.random() * 100,
      });
    }
  }

  get activeCount(): number {
    return this.balls.reduce((n, b) => n + (b.active ? 1 : 0), 0);
  }

  /** Tire une boule depuis `origin` dans la direction `dir` (normalisée après coup). */
  fire(origin: THREE.Vector3, dir: THREE.Vector3, target: Enemy | null): void {
    const b = this.balls.find((x) => !x.active) ?? this.balls[0];
    console.debug(
      `[Fireball] tir depuis ${origin.x.toFixed(1)},${origin.y.toFixed(1)},${origin.z.toFixed(1)} cible=${target?.config.name ?? 'aucune'}`,
    );
    b.active = true;
    b.age = 0;
    b.trailT = 0;
    b.target = target;
    b.root.position.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(SPEED);
    b.root.visible = true;
    // Flash de bouche + gerbe d'étincelles au départ
    this.fx.lights.flash(origin.x, origin.y, origin.z, 3.5, 0.16, 0xffa040, 7);
    this.fx.particles.spawn(origin.x, origin.y, origin.z, 0, 7, {
      speed: 3.5, up: 1.5, spread: 0.7, life: [0.18, 0.4], size: [0.05, 0.12], color: GOLD,
    });
  }

  private impact(b: Fireball): void {
    b.active = false;
    b.root.visible = false;
    const p = b.root.position;
    const { hits } = this.enemies.dealAoeDamage(p.x, p.z, AOE_RADIUS, DMG, {
      knockback: 3.5,
      kind: 'pyro',
      fx: this.fx,
      elapsed: performance.now() / 1000,
    });
    console.debug(
      `[Fireball] impact ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} âge=${b.age.toFixed(2)} touchés=${hits}`,
    );
    this.fx.particles.explosion(p.x, p.y, p.z, 0.55);
    this.fx.decals.scorch(p.x, p.z, 1.15, 4);
    this.fx.lights.flash(p.x, p.y + 0.3, p.z, 6.5, 0.3, 0xff7a3c, 12);
    this.fx.shake.add(0.12);
    this.onImpact?.(p.x, p.y, p.z);
    if (hits > 0) {
      this.fx.hitstop(0.035, 0.2);
      this.onHits(hits);
    }
  }

  update(dt: number, elapsed: number): void {
    for (const b of this.balls) {
      if (!b.active) continue;
      b.age += dt;
      const p = b.root.position;

      // Homing amorti vers le torse de la cible (encore vivante)
      if (b.target && b.target.alive) {
        const t = b.target;
        this.tmp.set(t.position.x, t.position.y + t.config.barHeight * 0.45, t.position.z);
        this.tmp.sub(p).normalize().multiplyScalar(SPEED);
        const k = 1 - Math.exp(-HOMING * dt);
        b.vel.lerp(this.tmp, k);
      }

      p.addScaledVector(b.vel, dt);

      // Traînée de braises
      b.trailT += dt;
      if (b.trailT >= TRAIL_EVERY) {
        b.trailT = 0;
        this.fx.particles.spawn(p.x, p.y, p.z, 1, 2, {
          speed: 0.4, up: 0.6, spread: 0.35, life: [0.25, 0.5], size: [0.05, 0.11], color: PYRO,
        });
      }

      // Pulsation + rotation de la sphère de feu
      const pulse = 1 + 0.16 * Math.sin(elapsed * 27 + b.seed);
      b.shell.scale.setScalar(pulse);
      b.core.scale.setScalar(1 + 0.1 * Math.sin(elapsed * 34 + b.seed * 1.7));
      b.root.rotation.y += dt * 9;

      // Impacts : ennemi, sol, fin de vie
      let hit = b.age >= LIFE || p.y < this.groundAt(p.x, p.z) + 0.08;
      if (!hit) {
        for (const e of this.enemies.enemies) {
          if (!e.alive) continue;
          const dx = e.position.x - p.x;
          const dz = e.position.z - p.z;
          if (dx * dx + dz * dz > (e.config.radius + HIT_RADIUS) ** 2) continue;
          const cy = e.position.y + e.config.barHeight * 0.45;
          if (Math.abs(p.y - cy) < 1.7) {
            hit = true;
            break;
          }
        }
      }
      if (hit) this.impact(b);
    }
  }
}
