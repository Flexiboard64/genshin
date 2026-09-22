import * as THREE from 'three';
import { PYRO } from './Particles';

/**
 * Décalcomanies au sol conformées au terrain : brûlures persistantes, cercles
 * runiques (texture Magnific ou repli procédural), ondes de choc expansives et
 * télégraphes d'attaque ennemis. Pools réutilisés, zéro alloc dans la boucle.
 */

const SCORCH_POOL = 10;
const RUNE_POOL = 4;
const SHOCK_POOL = 6;
const TELEGRAPH_POOL = 3;

interface Decal {
  mesh: THREE.Mesh;
  life: number;
  total: number;
  spin: number;
  maxRadius: number;
}

function scorchTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(14,7,4,0.96)');
  grad.addColorStop(0.55, 'rgba(18,9,5,0.85)');
  grad.addColorStop(0.82, 'rgba(24,11,5,0.5)');
  grad.addColorStop(1, 'rgba(20,10,5,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  // Liseré de braise irrégulier
  ctx.strokeStyle = 'rgba(255,116,42,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    const a0 = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(64, 64, 44 + Math.random() * 12, a0, a0 + 0.35 + Math.random() * 0.6);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function fallbackRuneTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.strokeStyle = 'rgba(255,190,90,0.95)';
  ctx.lineWidth = 3;
  for (const r of [120, 96, 64]) {
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(128 + Math.cos(a) * 96, 128 + Math.sin(a) * 96);
    ctx.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    ctx.beginPath();
    ctx.arc(128 + Math.cos(a) * 80, 128 + Math.sin(a) * 80, 10, 0, Math.PI * 2);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

function telegraphTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,42,26,0.28)');
  grad.addColorStop(0.8, 'rgba(255,42,26,0.32)');
  grad.addColorStop(0.94, 'rgba(255,60,30,0.85)');
  grad.addColorStop(1, 'rgba(255,60,30,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class GroundDecals {
  private readonly scorches: Decal[] = [];
  private readonly runes: Decal[] = [];
  private readonly shocks: Decal[] = [];
  private readonly telegraphs: Decal[] = [];
  private scorchIdx = 0;
  private runeIdx = 0;
  private shockIdx = 0;
  private telegraphIdx = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundAt: (x: number, z: number) => number,
    runeTexture: THREE.Texture | null = null,
  ) {
    for (let i = 0; i < SCORCH_POOL; i++) {
      this.scorches.push(this.makeDecal(scorchTexture(), 26, THREE.NormalBlending, 1));
    }
    const runeTex = runeTexture ?? fallbackRuneTexture();
    for (let i = 0; i < RUNE_POOL; i++) {
      this.runes.push(this.makeDecal(runeTex, 48, THREE.AdditiveBlending, 5));
    }
    for (let i = 0; i < SHOCK_POOL; i++) {
      const geo = new THREE.RingGeometry(0.84, 1, 56);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: PYRO,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      mesh.visible = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.shocks.push({ mesh, life: 0, total: 1, spin: 0, maxRadius: 8 });
    }
    for (let i = 0; i < TELEGRAPH_POOL; i++) {
      this.telegraphs.push(this.makeDecal(telegraphTexture(), 40, THREE.NormalBlending, 4));
    }
  }

  private makeDecal(
    texture: THREE.Texture,
    segments: number,
    blending: THREE.Blending,
    renderOrder: number,
  ): Decal {
    const geo = new THREE.CircleGeometry(1, segments);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    mesh.visible = false;
    mesh.renderOrder = renderOrder;
    this.scene.add(mesh);
    return { mesh, life: 0, total: 1, spin: 0, maxRadius: 1 };
  }

  /** Conforme chaque vertex au terrain (géométrie unitaire, rayon réel = scale). */
  private conform(decal: Decal, x: number, z: number, radius: number): void {
    const mesh = decal.mesh;
    const baseY = this.groundAt(x, z);
    mesh.position.set(x, baseY + 0.06, z);
    mesh.scale.setScalar(radius);
    const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i) * radius;
      const vz = posAttr.getZ(i) * radius;
      const h = this.groundAt(x + vx, z + vz);
      posAttr.setY(i, h - baseY + 0.02);
    }
    posAttr.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }

  /** Marque de brûlure persistante. */
  scorch(x: number, z: number, radius: number, life = 7): void {
    const d = this.scorches[this.scorchIdx];
    this.scorchIdx = (this.scorchIdx + 1) % SCORCH_POOL;
    this.conform(d, x, z, radius);
    d.total = life;
    d.life = life;
    d.spin = 0;
    d.mesh.rotation.y = Math.random() * Math.PI * 2;
    d.mesh.visible = true;
  }

  /** Cercle runique additif qui tourne (casts E/Q). */
  rune(x: number, z: number, radius: number, life: number, color: THREE.Color | null = null): void {
    const d = this.runes[this.runeIdx];
    this.runeIdx = (this.runeIdx + 1) % RUNE_POOL;
    this.conform(d, x, z, radius);
    d.total = life;
    d.life = life;
    d.spin = 1.6;
    const mat = d.mesh.material as THREE.MeshBasicMaterial;
    mat.color.setRGB(1, 1, 1);
    if (color) mat.color.copy(color);
    d.mesh.visible = true;
  }

  /** Anneau de feu expansif (explosions, slam de golem). */
  shockwave(x: number, z: number, maxRadius: number, life = 0.55, color: THREE.Color | null = null): void {
    const d = this.shocks[this.shockIdx];
    this.shockIdx = (this.shockIdx + 1) % SHOCK_POOL;
    this.conform(d, x, z, maxRadius);
    d.total = life;
    d.life = life;
    d.maxRadius = maxRadius;
    const mat = d.mesh.material as THREE.MeshBasicMaterial;
    mat.color.copy(color ?? PYRO);
    d.mesh.visible = true;
  }

  /** Zone d'attaque ennemie affichée en rouge pulsé. */
  telegraph(x: number, z: number, radius: number, duration: number): void {
    const d = this.telegraphs[this.telegraphIdx];
    this.telegraphIdx = (this.telegraphIdx + 1) % TELEGRAPH_POOL;
    this.conform(d, x, z, radius);
    d.total = duration;
    d.life = duration;
    d.spin = 0;
    d.mesh.visible = true;
  }

  update(dt: number): void {
    for (const d of this.scorches) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      const t = 1 - Math.max(d.life, 0) / d.total;
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t * t);
      if (d.life <= 0) d.mesh.visible = false;
    }
    for (const d of this.runes) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      const t = 1 - Math.max(d.life, 0) / d.total;
      d.mesh.rotation.y += d.spin * dt;
      const grow = Math.min(1, t * 6);
      (d.mesh.material as THREE.MeshBasicMaterial).opacity =
        grow * (1 - THREE.MathUtils.smoothstep(t, 0.7, 1)) * 0.95;
      d.mesh.scale.setScalar(d.mesh.scale.x); // échelle fixée au spawn
      if (d.life <= 0) d.mesh.visible = false;
    }
    for (const d of this.shocks) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      const t = 1 - Math.max(d.life, 0) / d.total;
      const eased = 1 - (1 - t) * (1 - t);
      // Le rayon visuel va de 15 % à 100 % du rayon max (géométrie conformée au spawn)
      const s = 0.15 + eased * 0.85;
      d.mesh.scale.setScalar(Math.max(d.maxRadius * s, 0.01));
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
      if (d.life <= 0) d.mesh.visible = false;
    }
    for (const d of this.telegraphs) {
      if (!d.mesh.visible) continue;
      d.life -= dt;
      const pulse = 0.72 + 0.28 * Math.sin(d.life * 18);
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = pulse * 0.9;
      if (d.life <= 0) d.mesh.visible = false;
    }
  }
}
