import * as THREE from 'three';
import type { DamageKind } from '../game/combat/types';

const POOL = 24;
const LIFE = 0.95;

interface DmgEntry {
  el: HTMLDivElement;
  life: number;
  pos: THREE.Vector3;
  drift: number;
}

/**
 * Nombres de dégâts projetés à l'écran (pool DOM, zéro alloc après init) :
 * blanc physique, orange Pyro, rouge pour les dégâts subis, vert soin,
 * crits jaunes italiques agrandis — fidèle à Genshin Impact.
 */
export class DamageNumbers {
  private readonly entries: DmgEntry[] = [];
  private idx = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(container: HTMLElement) {
    const layer = document.createElement('div');
    layer.className = 'dmg-layer';
    container.appendChild(layer);
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-number';
      el.style.display = 'none';
      layer.appendChild(el);
      this.entries.push({ el, life: 0, pos: new THREE.Vector3(), drift: 0 });
    }
  }

  spawn(x: number, y: number, z: number, amount: number, kind: DamageKind, crit = false): void {
    const entry = this.entries[this.idx];
    this.idx = (this.idx + 1) % POOL;
    entry.life = LIFE;
    entry.pos.set(x, y, z);
    entry.drift = (Math.random() - 0.5) * 30;
    entry.el.textContent = String(Math.round(amount));
    entry.el.className = `dmg-number dmg-${kind}${crit ? ' dmg-crit' : ''}`;
    entry.el.style.display = 'block';
  }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    for (const entry of this.entries) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      if (entry.life <= 0) {
        entry.el.style.display = 'none';
        continue;
      }
      const t = 1 - entry.life / LIFE;
      this.tmp.copy(entry.pos).project(camera);
      if (this.tmp.z > 1 || this.tmp.z < -1) {
        entry.el.style.display = 'none';
        continue;
      }
      const sx = (this.tmp.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-this.tmp.y * 0.5 + 0.5) * window.innerHeight;
      const rise = 46 * t + 14 * t * t;
      const scale = t < 0.12 ? 1 + (0.12 - t) * 3.2 : 1;
      entry.el.style.transform = `translate(${sx + entry.drift * t}px, ${sy - rise}px) translate(-50%, -50%) scale(${scale})`;
      entry.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
    }
  }
}
