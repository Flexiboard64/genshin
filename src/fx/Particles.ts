import * as THREE from 'three';

/**
 * Système de particules de combat : un seul THREE.Points additif (1 draw call),
 * animation côté GPU (âge en shader), spawns côté CPU dans un ring buffer.
 * kind 0 = étincelle (rapide, gravité), 1 = braise (flottante, scintille),
 * kind 2 = flash lumineux (grossit puis s'éteint), 3 = débris incandescent.
 */

const CAPACITY = 3072;

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute float aKind;
attribute vec3 aColor;
attribute float aSeed;
uniform float uTime;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
varying float vKind;
varying float vSeed;
varying float vT;

void main() {
  float age = uTime - aBirth;
  float t = age / max(aLife, 1e-3);
  vT = t;
  vKind = aKind;
  vSeed = aSeed;
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vColor = vec3(0.0);
    return;
  }

  float isSpark = 1.0 - step(0.5, abs(aKind - 0.0));
  float isEmber = 1.0 - step(0.5, abs(aKind - 1.0));
  float isFlash = 1.0 - step(0.5, abs(aKind - 2.0));
  float isDebris = 1.0 - step(0.5, abs(aKind - 3.0));

  vec3 acc = vec3(0.0, -9.5, 0.0) * isSpark
    + vec3(0.0, 1.7, 0.0) * isEmber
    + vec3(0.0) * isFlash
    + vec3(0.0, -17.0, 0.0) * isDebris;

  vec3 pos = position + aVel * age + 0.5 * acc * age * age;
  // Les braises dérivent en spirale
  pos.x += sin(age * 7.0 + aSeed * 21.0) * 0.22 * isEmber;
  pos.z += cos(age * 6.0 + aSeed * 17.0) * 0.22 * isEmber;

  float scale = aSize * (
    isSpark * (1.0 - 0.55 * t) +
    isEmber * (0.75 + 0.5 * sin(age * 26.0 + aSeed * 40.0) * 0.5) +
    isFlash * (0.55 + 2.6 * t) +
    isDebris * (1.0 - 0.4 * t)
  );

  float flicker = 0.72 + 0.28 * sin(age * 31.0 + aSeed * 47.0);
  vAlpha =
    isSpark * (1.0 - t) * (1.0 - t) +
    isEmber * smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.5, 1.0, t)) * flicker +
    isFlash * (1.0 - t) * (1.0 - t) * 1.4 +
    isDebris * (1.0 - t * t);

  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = scale * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tMap;
varying float vAlpha;
varying vec3 vColor;
varying float vKind;
varying float vT;
void main() {
  vec4 tex = texture2D(tMap, gl_PointCoord);
  // Cœur blanc-chaud en début de vie, puis couleur d'espèce
  vec3 hot = vec3(1.0, 0.97, 0.88);
  vec3 col = mix(hot, vColor, smoothstep(0.0, 0.4, vT));
  // Les débris finissent en charbon sombre (faible contribution additive)
  float isDebris = 1.0 - step(0.5, abs(vKind - 3.0));
  col = mix(col, vColor * 0.25, isDebris * smoothstep(0.4, 1.0, vT));
  float a = tex.a * vAlpha;
  if (a < 0.008) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

export const PYRO = new THREE.Color(1.0, 0.46, 0.13);
export const PYRO_DEEP = new THREE.Color(0.86, 0.22, 0.05);
const TMP_COLOR = new THREE.Color();
export const GOLD = new THREE.Color(1.0, 0.78, 0.38);
export const CRYO = new THREE.Color(0.55, 0.85, 1.0);
export const CRYO_DEEP = new THREE.Color(0.2, 0.55, 0.95);

export class Particles {
  private readonly time = { value: 0 };
  private readonly pointScale = { value: 1 };
  private readonly geometry: THREE.BufferGeometry;
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);

    const dead = -1e4;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3));
    this.geometry.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3));
    this.geometry.setAttribute('aBirth', new THREE.BufferAttribute(new Float32Array(CAPACITY).fill(dead), 1));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(CAPACITY).fill(1), 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(CAPACITY), 1));
    this.geometry.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(CAPACITY), 1));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(CAPACITY), 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: this.time, uScale: this.pointScale, tMap: { value: texture } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(this.geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 6;
    scene.add(points);
  }

  /** Spawn bas niveau : cône/sphère selon spread, direction dominante optionnelle. */
  spawn(
    x: number,
    y: number,
    z: number,
    kind: number,
    count: number,
    opts: {
      speed?: number;
      up?: number;
      spread?: number;
      life?: [number, number];
      size?: [number, number];
      color?: THREE.Color | number;
      dirX?: number;
      dirZ?: number;
    } = {},
  ): void {
    const now = this.time.value;
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vel = this.geometry.getAttribute('aVel') as THREE.BufferAttribute;
    const birth = this.geometry.getAttribute('aBirth') as THREE.BufferAttribute;
    const life = this.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const size = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const kindAttr = this.geometry.getAttribute('aKind') as THREE.BufferAttribute;
    const colorAttr = this.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const seedAttr = this.geometry.getAttribute('aSeed') as THREE.BufferAttribute;

    const speed = opts.speed ?? 5;
    const up = opts.up ?? 2.5;
    const spread = opts.spread ?? 1;
    const [lifeMin, lifeMax] = opts.life ?? [0.3, 0.7];
    const [sizeMin, sizeMax] = opts.size ?? [0.06, 0.16];
    const color =
      opts.color === undefined
        ? PYRO
        : typeof opts.color === 'number'
          ? TMP_COLOR.setHex(opts.color)
          : opts.color;
    const hasDir = opts.dirX !== undefined || opts.dirZ !== undefined;
    const dirX = opts.dirX ?? 0;
    const dirZ = opts.dirZ ?? 0;

    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % CAPACITY;
      const angle = Math.random() * Math.PI * 2;
      const lateral = (0.25 + Math.random() * 0.75) * speed * spread;
      let vx = Math.cos(angle) * lateral;
      let vz = Math.sin(angle) * lateral;
      if (hasDir) {
        vx = vx * 0.45 + dirX * speed * (0.6 + Math.random() * 0.6);
        vz = vz * 0.45 + dirZ * speed * (0.6 + Math.random() * 0.6);
      }
      const vy = up * (0.35 + Math.random() * 0.9);
      pos.setXYZ(
        idx,
        x + (Math.random() - 0.5) * 0.22 * spread,
        y + (Math.random() - 0.5) * 0.16,
        z + (Math.random() - 0.5) * 0.22 * spread,
      );
      vel.setXYZ(idx, vx, vy, vz);
      birth.setX(idx, now + Math.random() * 0.05);
      life.setX(idx, lifeMin + Math.random() * (lifeMax - lifeMin));
      size.setX(idx, sizeMin + Math.random() * (sizeMax - sizeMin));
      kindAttr.setX(idx, kind);
      colorAttr.setXYZ(idx, color.r, color.g, color.b);
      seedAttr.setX(idx, Math.random());
    }
    for (const attr of [pos, vel, birth, life, size, kindAttr, colorAttr, seedAttr]) {
      attr.needsUpdate = true;
    }
  }

  /** Impact d'épée : étincelles en cône + flash + quelques braises. */
  hit(x: number, y: number, z: number, dirX: number, dirZ: number, heavy = false): void {
    const s = heavy ? 1.7 : 1;
    this.spawn(x, y, z, 0, Math.round(26 * s), {
      speed: 7.5 * s, up: 3, spread: 0.9, dirX, dirZ,
      life: [0.22, 0.5], size: [0.05, 0.13], color: GOLD,
    });
    this.spawn(x, y + 0.1, z, 2, 1, {
      speed: 0, up: 0, spread: 0.1, life: [0.16, 0.2], size: [0.8 * s, 1.1 * s], color: PYRO,
    });
    this.spawn(x, y, z, 1, Math.round(10 * s), {
      speed: 2.6, up: 2.4, spread: 1, life: [0.5, 1.1], size: [0.05, 0.12], color: PYRO,
    });
  }

  /** Explosion de flamme : flash + étincelles radiales + braises + débris. */
  explosion(x: number, y: number, z: number, scale = 1): void {
    this.spawn(x, y + 0.4, z, 2, 3, {
      speed: 0, up: 0.4, spread: 0.4, life: [0.22, 0.34], size: [1.6 * scale, 2.4 * scale], color: PYRO,
    });
    this.spawn(x, y + 0.3, z, 0, Math.round(70 * scale), {
      speed: 9 * scale, up: 6.5 * scale, spread: 1.1,
      life: [0.3, 0.75], size: [0.07, 0.18], color: GOLD,
    });
    this.spawn(x, y + 0.2, z, 1, Math.round(46 * scale), {
      speed: 3.6 * scale, up: 3.4, spread: 1.15,
      life: [0.7, 1.7], size: [0.06, 0.16], color: PYRO,
    });
    this.spawn(x, y + 0.35, z, 3, Math.round(22 * scale), {
      speed: 6 * scale, up: 7.5 * scale, spread: 1,
      life: [0.5, 1.0], size: [0.09, 0.2], color: PYRO_DEEP,
    });
  }

  /** Colonne de feu verticale (déchaînement Q). */
  pillar(x: number, y: number, z: number, scale = 1): void {
    this.spawn(x, y, z, 0, 90, {
      speed: 1.6, up: 13 * scale, spread: 0.7,
      life: [0.35, 0.8], size: [0.1, 0.26], color: GOLD,
    });
    this.spawn(x, y, z, 1, 60, {
      speed: 2.4, up: 9 * scale, spread: 0.9,
      life: [0.8, 1.9], size: [0.08, 0.2], color: PYRO,
    });
    this.spawn(x, y + 1.2 * scale, z, 2, 2, {
      speed: 0, up: 1.2, spread: 0.3, life: [0.3, 0.42], size: [2.2 * scale, 3 * scale], color: PYRO,
    });
  }

  /** Tourbillon convergent (charge du vortex E) — appelé chaque frame. */
  vortex(cx: number, cy: number, cz: number, radius: number, perFrame = 4): void {
    for (let i = 0; i < perFrame; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * (0.75 + Math.random() * 0.4);
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;
      // Vitesse tangentielle + légèrement centripète : spirale entrante
      const tx = -Math.sin(angle);
      const tz = Math.cos(angle);
      this.spawn(x, cy + Math.random() * 0.4, z, 1, 1, {
        speed: 0, up: 1.1, spread: 0, life: [0.4, 0.7], size: [0.05, 0.11], color: PYRO,
        dirX: tx * 3.2 - Math.cos(angle) * 2.6,
        dirZ: tz * 3.2 - Math.sin(angle) * 2.6,
      });
    }
  }

  /** Éclatement de slime (mort) : gerbe colorée + flash. */
  pop(x: number, y: number, z: number, color: THREE.Color, count = 40): void {
    this.spawn(x, y + 0.2, z, 0, count, {
      speed: 5.5, up: 4.5, spread: 1.2, life: [0.3, 0.7], size: [0.08, 0.2], color,
    });
    this.spawn(x, y + 0.25, z, 2, 1, {
      speed: 0, up: 0, spread: 0.2, life: [0.2, 0.26], size: [1.1, 1.4], color,
    });
  }

  update(dt: number, elapsed: number, camera: THREE.PerspectiveCamera, canvasHeight: number): void {
    void dt;
    this.time.value = elapsed;
    this.pointScale.value = (canvasHeight / 2) * camera.projectionMatrix.elements[5];
  }
}
