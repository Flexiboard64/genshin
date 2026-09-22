import * as THREE from 'three';

export const TERRAIN_SIZE = 400;
export const WATER_LEVEL = -0.8;
const SEGMENTS = 256;
const AMPLITUDE = 10;

/** Lac circulaire : dépression au sud-est, rive de sable autour de WATER_LEVEL. */
export const LAKE = { x: 70, z: -60, radius: 38, floor: -4.4 };

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Bruit basse fréquence exporté pour les clusters de végétation. */
export function noise2(x: number, z: number): number {
  return fbm(x, z, 3);
}

/** Hauteur du terrain en tout point — source unique de vérité (mesh, joueur, caméra, minimap). */
export function terrainHeight(x: number, z: number): number {
  const swell = (fbm(x * 0.006 + 4.7, z * 0.006 + 9.1, 3) - 0.5) * 2 * 6;
  const detail = (fbm(x * 0.02 + 13.7, z * 0.02 + 71.3, 4) - 0.5) * 2 * AMPLITUDE;
  const spawnFlat = smoothstep(6, 42, Math.hypot(x, z));
  let h = (swell + detail) * spawnFlat;

  const lakeDist = Math.hypot(x - LAKE.x, z - LAKE.z);
  const lakeMask = 1 - smoothstep(LAKE.radius * 0.55, LAKE.radius, lakeDist);
  if (lakeMask > 0) {
    const bed = LAKE.floor + (fbm(x * 0.05 + 31.7, z * 0.05 + 3.9, 2) - 0.5) * 0.9;
    h = h * (1 - lakeMask) + bed * lakeMask;
  }
  return h;
}

export interface TerrainMasks {
  height: number;
  /** 0 = plat, ~0.5 = pente raide (1 - normal.y). */
  slope: number;
  /** Distance au centre du lac. */
  lakeDist: number;
  /** 1 sur la bande de plage autour du niveau d'eau. */
  beach: number;
  /** 1 sous la surface de l'eau. */
  underwater: number;
}

/**
 * Grille de hauteurs précalculée, partagée par l'eau, l'herbe et la végétation
 * (évite des centaines de milliers d'appels fbm au placement).
 */
export class HeightGrid {
  readonly data: Float32Array;
  readonly step: number;
  readonly size: number;
  private readonly half: number;

  constructor(
    readonly resolution = 256,
    heightFn: (x: number, z: number) => number = terrainHeight,
    size = TERRAIN_SIZE,
  ) {
    this.size = size;
    this.half = size / 2;
    this.step = size / resolution;
    this.data = new Float32Array((resolution + 1) * (resolution + 1));
    for (let j = 0; j <= resolution; j++) {
      const z = -this.half + j * this.step;
      for (let i = 0; i <= resolution; i++) {
        this.data[j * (resolution + 1) + i] = heightFn(-this.half + i * this.step, z);
      }
    }
  }

  /** Hauteur interpolée bilinéaire (hors limites : clamp). */
  sample(x: number, z: number): number {
    const gx = Math.min(Math.max((x + this.half) / this.step, 0), this.resolution - 0.001);
    const gz = Math.min(Math.max((z + this.half) / this.step, 0), this.resolution - 0.001);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const r = this.resolution + 1;
    const a = this.data[j * r + i];
    const b = this.data[j * r + i + 1];
    const c = this.data[(j + 1) * r + i];
    const d = this.data[(j + 1) * r + i + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  masks(x: number, z: number): TerrainMasks {
    const height = this.sample(x, z);
    const e = this.step;
    const dx = (this.sample(x + e, z) - this.sample(x - e, z)) / (2 * e);
    const dz = (this.sample(x, z + e) - this.sample(x, z - e)) / (2 * e);
    const ny = 1 / Math.sqrt(1 + dx * dx + dz * dz);
    const lakeDist = Math.hypot(x - LAKE.x, z - LAKE.z);
    const beachNoise = noise2(x * 0.11 + 7.3, z * 0.11 + 2.1) - 0.5;
    return {
      height,
      slope: 1 - ny,
      lakeDist,
      beach: 1 - smoothstep(0.35, 1.5, height - WATER_LEVEL + beachNoise * 0.7),
      underwater: height < WATER_LEVEL - 0.05 ? 1 : 0,
    };
  }
}

export class Terrain {
  readonly mesh: THREE.Mesh;

  constructor(grass: THREE.Texture, dirt: THREE.Texture, rock: THREE.Texture, sand: THREE.Texture) {
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)));
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      metalness: 0,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.tGrass = { value: grass };
      shader.uniforms.tDirt = { value: dirt };
      shader.uniforms.tRock = { value: rock };
      shader.uniforms.tSand = { value: sand };
      shader.uniforms.uWaterLevel = { value: WATER_LEVEL };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;',
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWPos;
          varying vec3 vWNormal;
          uniform sampler2D tGrass;
          uniform sampler2D tDirt;
          uniform sampler2D tRock;
          uniform sampler2D tSand;
          uniform float uWaterLevel;
          float th_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float th_noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(th_hash(i), th_hash(i + vec2(1.0, 0.0)), u.x),
              mix(th_hash(i + vec2(0.0, 1.0)), th_hash(i + vec2(1.0, 1.0)), u.x),
              u.y);
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 grassCol = texture2D(tGrass, vWPos.xz * 0.14).rgb;
            vec3 dirtCol = texture2D(tDirt, vWPos.xz * 0.14).rgb;
            vec3 rockCol = texture2D(tRock, vWPos.xz * 0.06).rgb;
            vec3 sandCol = texture2D(tSand, vWPos.xz * 0.12).rgb;
            float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
            float rockMask = smoothstep(0.16, 0.32, slope);
            rockMask = max(rockMask, smoothstep(8.0, 14.0, vWPos.y) * 0.85);
            float dirtNoise = th_noise(vWPos.xz * 0.055) * 0.6 + th_noise(vWPos.xz * 0.16) * 0.4;
            float dirtMask = smoothstep(0.58, 0.72, dirtNoise) * (1.0 - rockMask);
            float sandNoise = (th_noise(vWPos.xz * 0.11) - 0.5) * 0.7;
            float sandMask = 1.0 - smoothstep(uWaterLevel + 0.35, uWaterLevel + 1.5, vWPos.y + sandNoise);
            // Le fond du lac reste sableux, sauf parois très raides
            sandMask = max(sandMask, 1.0 - smoothstep(uWaterLevel + 0.1, uWaterLevel + 0.6, vWPos.y));
            sandMask = min(sandMask, 1.0 - smoothstep(0.30, 0.45, slope));
            vec3 albedo = mix(mix(mix(grassCol, dirtCol, dirtMask), rockCol, rockMask), sandCol, sandMask);
            // Légère variation de teinte de prairie à grande échelle
            float meadow = th_noise(vWPos.xz * 0.02);
            albedo *= mix(vec3(1.0), vec3(0.94, 1.05, 0.90), meadow * 0.6 * (1.0 - sandMask));
            diffuseColor.rgb *= albedo;
          }`,
        );
    };

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
  }

  getHeight(x: number, z: number): number {
    return terrainHeight(x, z);
  }
}
