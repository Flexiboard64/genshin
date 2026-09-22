import * as THREE from 'three';
import { gorgeCenterX, GORGE } from './SnowTerrain';

/**
 * Météo Snezhnaya : chute de neige GPU (1 draw call), rafales de neige
 * rasante (2e draw call) et nappes de brouillard localisées (sprites).
 */

const SNOW_COUNT = 13000;
const BLOW_COUNT = 260;

const SNOW_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform float uIntensity;
uniform float uPixelRatio;
attribute vec4 aSeed; // x: vitesse chute, y: phase balancement, z: amplitude, w: taille
varying float vAlpha;

void main() {
  vec3 box = vec3(84.0, 38.0, 84.0);
  vec3 p = position;
  // Chute + vent + balancement sinusoïdal
  p.y -= uTime * (2.2 + aSeed.x * 2.6);
  p.x += uTime * (1.1 + aSeed.x * 0.8) + sin(uTime * 1.3 + aSeed.y * 6.2831) * aSeed.z;
  p.z += uTime * 0.55 + cos(uTime * 1.05 + aSeed.y * 6.2831) * aSeed.z * 0.7;
  // Boîte centrée sur la caméra (wrap infini)
  vec3 rel = mod(p - uCamPos, box) - box * 0.5;
  vec3 world = uCamPos + rel;
  vAlpha = (0.72 + aSeed.x * 0.28) * uIntensity;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (1.3 + aSeed.w * 1.9) * (0.75 + 0.45 * uIntensity);
  gl_PointSize = size * uPixelRatio * (180.0 / max(1.0, -mv.z));
}
`;

const SNOW_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float a = tex.r * vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), a);
}
`;

const BLOW_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform float uIntensity;
uniform float uPixelRatio;
attribute vec4 aSeed; // x: vitesse dérive, y: phase, z: hauteur, w: taille
varying float vAlpha;

void main() {
  vec3 box = vec3(90.0, 10.0, 90.0);
  vec3 p = position;
  // Dérive horizontale rapide (vent polaire) + légère houle
  p.x += uTime * (9.0 + aSeed.x * 7.0);
  p.z += uTime * (2.5 + aSeed.x * 2.0) + sin(uTime * 0.9 + aSeed.y * 6.2831) * 3.0;
  p.y = uCamPos.y - 2.6 + aSeed.z * 5.0 + sin(uTime * 0.7 + aSeed.y * 6.2831) * 0.8;
  vec2 rel = mod(p.xz - uCamPos.xz, box.xz) - box.xz * 0.5;
  vec3 world = vec3(uCamPos.x + rel.x, p.y, uCamPos.z + rel.y);
  vAlpha = (0.08 + aSeed.x * 0.10) * uIntensity;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (7.0 + aSeed.w * 9.0);
  gl_PointSize = size * uPixelRatio * (180.0 / max(1.0, -mv.z));
}
`;

const BLOW_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float a = tex.r * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a);
}
`;

/** Texture de secours si l'asset Magnific manque : dégradé radial blanc sur noir. */
function fallbackPuff(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chute de neige globale : un seul THREE.Points, zéro allocation par frame. */
class Snowfall {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(flake: THREE.Texture | null) {
    const flakeTex = flake ?? fallbackPuff();
    const rng = seededRandom(4242);
    const positions = new Float32Array(SNOW_COUNT * 3);
    const seeds = new Float32Array(SNOW_COUNT * 4);
    for (let i = 0; i < SNOW_COUNT; i++) {
      positions[i * 3] = rng() * 84;
      positions[i * 3 + 1] = rng() * 38;
      positions[i * 3 + 2] = rng() * 84;
      seeds[i * 4] = rng();
      seeds[i * 4 + 1] = rng();
      seeds[i * 4 + 2] = 0.4 + rng() * 1.6;
      seeds[i * 4 + 3] = rng();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    this.material = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uIntensity: { value: 1 },
        uPixelRatio: { value: 1 },
        uMap: { value: flakeTex },
      },
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.name = 'snowfall';
  }

  update(elapsed: number, cameraPos: THREE.Vector3, gust: number, pixelRatio: number): void {
    this.material.uniforms.uTime.value = elapsed;
    (this.material.uniforms.uCamPos.value as THREE.Vector3).copy(cameraPos);
    this.material.uniforms.uIntensity.value = gust;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }
}

/** Rafales de neige rasante : nappes dérivantes au sol, 1 draw call. */
class BlowingSnow {
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;

  constructor(puff: THREE.Texture | null) {
    const puffTex = puff ?? fallbackPuff();
    const rng = seededRandom(977);
    const positions = new Float32Array(BLOW_COUNT * 3);
    const seeds = new Float32Array(BLOW_COUNT * 4);
    for (let i = 0; i < BLOW_COUNT; i++) {
      positions[i * 3] = rng() * 90;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = rng() * 90;
      seeds[i * 4] = rng();
      seeds[i * 4 + 1] = rng();
      seeds[i * 4 + 2] = rng();
      seeds[i * 4 + 3] = rng();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));

    this.material = new THREE.ShaderMaterial({
      vertexShader: BLOW_VERT,
      fragmentShader: BLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uIntensity: { value: 1 },
        uPixelRatio: { value: 1 },
        uMap: { value: puffTex },
      },
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.points.name = 'blowing-snow';
  }

  update(elapsed: number, cameraPos: THREE.Vector3, gust: number, pixelRatio: number): void {
    this.material.uniforms.uTime.value = elapsed;
    (this.material.uniforms.uCamPos.value as THREE.Vector3).copy(cameraPos);
    this.material.uniforms.uIntensity.value = gust;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }
}

interface FogPatch {
  sprite: THREE.Sprite;
  baseOpacity: number;
  phase: number;
  drift: number;
}

/** Nappes de brume ancrées (forêt ouest + gorge), pulsation lente. */
class FogPatches {
  readonly group = new THREE.Group();
  private readonly patches: FogPatch[] = [];

  constructor(puff: THREE.Texture | null, groundAt: (x: number, z: number) => number) {
    this.group.name = 'fog-patches';
    const puffTex = puff ?? fallbackPuff();
    const rng = seededRandom(1313);
    const spots: { x: number; z: number; cyan: boolean }[] = [];
    // Forêt de l'ouest / sud
    for (let i = 0; i < 8; i++) {
      spots.push({ x: -25 - rng() * 85, z: -5 - rng() * 85, cyan: false });
    }
    spots.push({ x: -20 - rng() * 70, z: 40 + rng() * 60, cyan: false });
    // Fond de gorge (brume cyan lumineuse)
    for (let i = 0; i < 6; i++) {
      const z = -120 + i * 55 + rng() * 25;
      spots.push({ x: gorgeCenterX(z), z, cyan: true });
    }

    for (const spot of spots) {
      const material = new THREE.SpriteMaterial({
        map: puffTex,
        alphaMap: puffTex,
        color: spot.cyan ? 0x9fd8f0 : 0xcdd8ec,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      const gorge = spot.cyan;
      const y = gorge
        ? GORGE.floor + 4 + rng() * 4
        : groundAt(spot.x, spot.z) + 2.5 + rng() * 3;
      sprite.position.set(spot.x, y, spot.z);
      const w = gorge ? 26 + rng() * 18 : 34 + rng() * 22;
      sprite.scale.set(w, w * 0.32, 1);
      sprite.renderOrder = 6;
      this.group.add(sprite);
      this.patches.push({
        sprite,
        baseOpacity: gorge ? 0.16 + rng() * 0.08 : 0.10 + rng() * 0.07,
        phase: rng() * Math.PI * 2,
        drift: 0.3 + rng() * 0.7,
      });
    }
  }

  update(elapsed: number): void {
    for (const p of this.patches) {
      const m = p.sprite.material;
      m.opacity = p.baseOpacity * (0.7 + 0.3 * Math.sin(elapsed * 0.24 + p.phase));
      p.sprite.position.x += Math.sin(elapsed * 0.05 * p.drift + p.phase) * 0.004;
    }
  }
}

/** Façade unique : neige + rafales + brumes, pilotées par une rafale globale. */
export class Weather {
  readonly group = new THREE.Group();
  private readonly snowfall: Snowfall;
  private readonly blowing: BlowingSnow;
  private readonly fog: FogPatches;
  private gust = 1;

  constructor(
    flake: THREE.Texture | null,
    puff: THREE.Texture | null,
    groundAt: (x: number, z: number) => number,
  ) {
    this.group.name = 'weather';
    this.snowfall = new Snowfall(flake);
    this.blowing = new BlowingSnow(puff);
    this.fog = new FogPatches(puff, groundAt);
    this.group.add(this.snowfall.points, this.blowing.points, this.fog.group);
  }

  update(dt: number, elapsed: number, cameraPos: THREE.Vector3, pixelRatio: number): void {
    // Rafales sinusoïdales lentes : la neige redouble par moments
    const target =
      0.82 +
      0.3 * Math.sin(elapsed * 0.11) +
      0.22 * Math.sin(elapsed * 0.043 + 2.1) *
        Math.sin(elapsed * 0.017 + 0.7);
    this.gust += (target - this.gust) * Math.min(1, dt * 0.8);
    // La neige tombe dans la zone de départ (forêt, lac, gorge) mais se lève
    // en approchant du palais : fondu entre z=-68 et z=-90, escaliers dégagés
    const zone = THREE.MathUtils.smoothstep(cameraPos.z, -90, -68);
    this.snowfall.update(elapsed, cameraPos, this.gust * zone, pixelRatio);
    this.blowing.update(elapsed, cameraPos, Math.max(0, this.gust - 0.35) * 1.4 * zone, pixelRatio);
    this.fog.update(elapsed);
  }
}
