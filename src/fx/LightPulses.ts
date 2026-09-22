import * as THREE from 'three';

/**
 * Pulsations lumineuses poolées : flashs orange sur impacts et explosions.
 * Sans ombres, distance limitée — le bloom fait le reste.
 */

const POOL = 5;

interface Pulse {
  light: THREE.PointLight;
  life: number;
  total: number;
  peak: number;
}

export class LightPulses {
  private readonly pulses: Pulse[] = [];
  private idx = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const light = new THREE.PointLight(0xff7a3c, 0, 14, 2);
      light.visible = false;
      light.castShadow = false;
      scene.add(light);
      this.pulses.push({ light, life: 0, total: 1, peak: 1 });
    }
  }

  flash(
    x: number,
    y: number,
    z: number,
    intensity = 6,
    duration = 0.35,
    color: THREE.ColorRepresentation = 0xff7a3c,
    distance = 14,
  ): void {
    const p = this.pulses[this.idx];
    this.idx = (this.idx + 1) % POOL;
    p.light.position.set(x, y, z);
    p.light.color.set(color);
    p.light.distance = distance;
    p.peak = intensity;
    p.total = duration;
    p.life = duration;
    p.light.visible = true;
    p.light.intensity = intensity;
  }

  update(dt: number): void {
    for (const p of this.pulses) {
      if (!p.light.visible) continue;
      p.life -= dt;
      const t = Math.max(p.life, 0) / p.total;
      p.light.intensity = p.peak * t * t;
      if (p.life <= 0) {
        p.light.visible = false;
        p.light.intensity = 0;
      }
    }
  }
}
