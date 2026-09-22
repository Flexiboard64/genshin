import * as THREE from 'three';
import { HeightGrid, noise2 } from '../../world/Terrain';

export const SNOW_SIZE = 400;
/** Niveau de la glace (lac gelé + rivière de la gorge) : solide, pas de nage. */
export const ICE_LEVEL = -1.2;
/** Plateau du palais Fatui (nord). */
export const PALACE = { x: 0, z: -118, radius: 30, height: 16 };
/** Gorge de glace à l'est : ligne sinueuse, canyon profond. */
export const GORGE = { x: 95, halfWidth: 15, floor: -13.5 };
/** Lac gelé central praticable. */
export const FROZEN_LAKE = { x: 40, z: 25, radius: 32 };
/** Promontoire d'arrivée (portail retour) surplombant la gorge. */
export const SPAWN = { x: 60, z: -5 };
/** Village de Beryozka (sud-ouest) : disque aplati pour les izbas. */
export const TOWN = { x: -50, z: 64, radius: 34, height: 2.6 };
/** Piton de planage : pic parabolique au sommet doux, tremplin vers le lac. */
export const PEAK = { x: -15, z: -10, radius: 16, height: 18, base: 2.5 };
/** Ravin ouest entre le village et la forêt (pont de bois). */
export const RAVINE = { halfWidth: 5.5, floor: -3.6 };
/** Forêt des Murmures : sapins denses + brouillard de quête. */
export const FOREST = { x: -75, z: -53, radius: 36 };

/** Axe du ravin ouest à une coordonnée z donnée. */
export function ravineCenterX(z: number): number {
  return -70 + 8 * Math.sin(z * 0.045);
}

/**
 * Sentiers damés du monde — source UNIQUE partagée par pathDist (CPU) et le
 * shader de splat (GPU) : ne jamais dupliquer cette liste ailleurs.
 */
export const PATH_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [SPAWN.x, SPAWN.z, 24, -32],
  [24, -32, 0, -62],
  [SPAWN.x, SPAWN.z, 26, 12],
  [24, -32, -18, 20],
  [-18, 20, -44, 56],
  [-44, 56, -62, 17],
  [-62, 17, -73, -46],
  [-18, 20, -50, -46],
  [-18, 20, -13, -4],
];

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

/** Bruit ridgé (crêtes nettes) pour les crevasses. */
function ridged(x: number, y: number): number {
  return 1 - Math.abs(2 * fbm(x, y, 3) - 1);
}

/** Axe de la gorge à une coordonnée z donnée. */
export function gorgeCenterX(z: number): number {
  return GORGE.x + 14 * Math.sin(z * 0.012) + 6 * Math.sin(z * 0.031 + 2.4);
}

/** Distance horizontale à l'axe de la gorge. */
export function gorgeDist(x: number, z: number): number {
  return Math.abs(x - gorgeCenterX(z));
}

/**
 * Intensité des crevasses lumineuses (0..1) — champs de glace à l'est et au sud.
 * Réutilisé par CrevasseGlow pour placer lueurs et cristaux.
 */
export function crevasseIntensity(x: number, z: number): number {
  const zone =
    smoothstep(6, 30, x) * (1 - smoothstep(FROZEN_LAKE.radius * 0.7, FROZEN_LAKE.radius, Math.hypot(x - FROZEN_LAKE.x, z - FROZEN_LAKE.z)) * 0.85) *
    (1 - smoothstep(GORGE.halfWidth + 6, GORGE.halfWidth + 22, gorgeDist(x, z)));
  const c = smoothstep(0.955, 0.995, ridged(x * 0.045 + 3.1, z * 0.045 + 8.7));
  return c * zone;
}

/** Hauteur du monde Snezhnaya — source unique (mesh, joueur, caméra, minimap). */
export function snowHeight(x: number, z: number): number {
  // Collines de base + congères
  const swell = (fbm(x * 0.005 + 7.3, z * 0.005 + 3.7, 3) - 0.5) * 2 * 5.5;
  const detail = (fbm(x * 0.018 + 21.7, z * 0.018 + 51.3, 4) - 0.5) * 2 * 6;
  const dunes = (fbm(x * 0.06 + 9.1, z * 0.06 + 44.2, 2) - 0.5) * 1.4;
  let h = swell + detail + dunes;

  // Aplanissement du promontoire d'arrivée
  const spawnFlat = smoothstep(4, 22, Math.hypot(x - SPAWN.x, z - SPAWN.z));
  h = h * (0.35 + 0.65 * spawnFlat) + 2.2 * (1 - spawnFlat);

  // Plateau du palais + rampe de l'escalier monumental au sud
  const pDist = Math.hypot(x - PALACE.x, z - PALACE.z);
  const plateauMask = 1 - smoothstep(PALACE.radius, PALACE.radius + 26, pDist);
  const corridor = 1 - smoothstep(9, 16, Math.abs(x - PALACE.x));
  const rampT = smoothstep(-64, -100, z) * (1 - smoothstep(-100, -108, z));
  const rampMask = corridor * rampT;
  h = h * (1 - Math.max(plateauMask, rampMask)) + PALACE.height * Math.max(plateauMask, rampMask);

  // Lac gelé : aplatissement au niveau de la glace
  const lakeDist = Math.hypot(x - FROZEN_LAKE.x, z - FROZEN_LAKE.z);
  const lakeMask = 1 - smoothstep(FROZEN_LAKE.radius * 0.62, FROZEN_LAKE.radius, lakeDist);
  if (lakeMask > 0) {
    const bed = ICE_LEVEL - 0.35 + (fbm(x * 0.07 + 11.3, z * 0.07 + 5.9, 2) - 0.5) * 0.3;
    h = h * (1 - lakeMask) + bed * lakeMask;
  }

  // Gorge : canyon profond aux parois raides, fond plat gelé
  const gd = gorgeDist(x, z);
  const gorgeMask = 1 - smoothstep(GORGE.halfWidth, GORGE.halfWidth + 17, gd);
  if (gorgeMask > 0) {
    const floor = GORGE.floor + (fbm(x * 0.05 + 2.2, z * 0.05 + 17.7, 2) - 0.5) * 0.6;
    h = h * (1 - gorgeMask) + floor * gorgeMask;
  }

  // Village de Beryozka : disque aplati à hauteur fixe (fondations des izbas)
  const tDist = Math.hypot(x - TOWN.x, z - TOWN.z);
  const townMask = 1 - smoothstep(TOWN.radius, TOWN.radius + 13, tDist);
  if (townMask > 0) {
    const townH = TOWN.height + (fbm(x * 0.08 + 3.3, z * 0.08 + 9.9, 2) - 0.5) * 0.5;
    h = h * (1 - townMask) + townH * townMask;
  }

  // Piton de planage : bosse parabolique lisse (montable à pied), sommet doux
  {
    const pd = Math.hypot(x - PEAK.x, z - PEAK.z);
    const t = Math.min(1, pd / PEAK.radius);
    const cone = PEAK.base + PEAK.height * (1 - t * t);
    if (cone > h) h = cone;
  }

  // Ravin ouest : bande creusée entre village et forêt (franchie par le pont)
  {
    const span = smoothstep(-29, -17, z) * (1 - smoothstep(37, 51, z));
    if (span > 0) {
      const rd = Math.abs(x - ravineCenterX(z));
      const rm = (1 - smoothstep(RAVINE.halfWidth, RAVINE.halfWidth + 5, rd)) * span;
      if (rm > 0) {
        const floorH = RAVINE.floor + (fbm(x * 0.09 + 5.5, z * 0.09 + 1.1, 2) - 0.5) * 0.4;
        h = h * (1 - rm) + floorH * rm;
      }
    }
  }

  // Crevasses : entailles peu profondes (la lueur vient de CrevasseGlow)
  h -= crevasseIntensity(x, z) * 2.1;

  return h;
}

export interface SnowMasks {
  height: number;
  slope: number;
  /** 1 au fond de la gorge / sous la paroi. */
  gorge: number;
  /** 1 sur le plateau ou la rampe du palais. */
  palace: number;
  /** 1 sur le lac gelé ou le fond de gorge (glace praticable). */
  ice: number;
  crevasse: number;
  /** 1 dans le village de Beryozka (pas de végétation sauvage). */
  town: number;
  /** 1 dans la Forêt des Murmures (sapins denses, brouillard). */
  forest: number;
}

export function snowMasks(grid: HeightGrid, x: number, z: number): SnowMasks {
  const height = grid.sample(x, z);
  const e = grid.step;
  const dx = (grid.sample(x + e, z) - grid.sample(x - e, z)) / (2 * e);
  const dz = (grid.sample(x, z + e) - grid.sample(x, z - e)) / (2 * e);
  const ny = 1 / Math.sqrt(1 + dx * dx + dz * dz);
  const gd = gorgeDist(x, z);
  const gorge = 1 - smoothstep(GORGE.halfWidth + 2, GORGE.halfWidth + 18, gd);
  const pDist = Math.hypot(x - PALACE.x, z - PALACE.z);
  const palace = 1 - smoothstep(PALACE.radius + 4, PALACE.radius + 22, pDist);
  const lakeDist = Math.hypot(x - FROZEN_LAKE.x, z - FROZEN_LAKE.z);
  const lake = 1 - smoothstep(FROZEN_LAKE.radius * 0.8, FROZEN_LAKE.radius + 6, lakeDist);
  const gorgeFloor = smoothstep(GORGE.floor + 2.5, GORGE.floor + 0.8, height) * gorge;
  const town = 1 - smoothstep(TOWN.radius, TOWN.radius + 12, Math.hypot(x - TOWN.x, z - TOWN.z));
  const forest = 1 - smoothstep(FOREST.radius, FOREST.radius + 14, Math.hypot(x - FOREST.x, z - FOREST.z));
  return {
    height,
    slope: 1 - ny,
    gorge,
    palace,
    ice: Math.max(lake, gorgeFloor),
    crevasse: crevasseIntensity(x, z),
    town,
    forest,
  };
}

/** Distance au sentier damé — segments partagés avec le shader de splat. */
export function pathDist(x: number, z: number): number {
  let best = Infinity;
  for (const [ax, az, bx, bz] of PATH_SEGMENTS) {
    const abx = bx - ax;
    const abz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz)));
    best = Math.min(best, Math.hypot(x - (ax + abx * t), z - (az + abz * t)));
  }
  return best;
}

/** Corps GLSL de st_pathDist généré depuis PATH_SEGMENTS (synchro CPU/GPU). */
const PATH_DIST_GLSL = `
float st_pathDist(vec2 p) {
  float d = 1e9;
${PATH_SEGMENTS.map(
  ([ax, az, bx, bz]) =>
    `  d = min(d, st_segDist(p, vec2(${ax.toFixed(1)}, ${az.toFixed(1)}), vec2(${bx.toFixed(1)}, ${bz.toFixed(1)})));`,
).join('\n')}
  return d;
}`;

export class SnowTerrain {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private time = 0;

  constructor(
    snow: THREE.Texture,
    ice: THREE.Texture,
    rock: THREE.Texture,
    paving: THREE.Texture,
    path: THREE.Texture,
    pavingVillage: THREE.Texture,
  ) {
    const geometry = new THREE.PlaneGeometry(SNOW_SIZE, SNOW_SIZE, 256, 256);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      positions.setY(i, snowHeight(positions.getX(i), positions.getZ(i)));
    }
    geometry.computeVertexNormals();

    this.uniforms = {
      tSnow: { value: snow },
      tIce: { value: ice },
      tRock: { value: rock },
      tPaving: { value: paving },
      tPath: { value: path },
      tPavingVillage: { value: pavingVillage },
      uTime: { value: 0 },
      uGorgeW: { value: GORGE.halfWidth },
      uGorgeFloor: { value: GORGE.floor },
      uPalace: { value: new THREE.Vector3(PALACE.x, PALACE.z, PALACE.radius) },
      uLake: { value: new THREE.Vector3(FROZEN_LAKE.x, FROZEN_LAKE.z, FROZEN_LAKE.radius) },
      uTown: { value: new THREE.Vector3(TOWN.x, TOWN.z, TOWN.radius) },
      uIceLevel: { value: ICE_LEVEL },
    };

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
    });
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

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
          uniform sampler2D tSnow;
          uniform sampler2D tIce;
          uniform sampler2D tRock;
          uniform sampler2D tPaving;
          uniform sampler2D tPath;
          uniform sampler2D tPavingVillage;
          uniform float uTime;
          uniform float uGorgeW;
          uniform float uGorgeFloor;
          uniform vec3 uPalace;
          uniform vec3 uLake;
          uniform vec3 uTown;
          uniform float uIceLevel;
          float st_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float st_noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(st_hash(i), st_hash(i + vec2(1.0, 0.0)), u.x),
              mix(st_hash(i + vec2(0.0, 1.0)), st_hash(i + vec2(1.0, 1.0)), u.x),
              u.y);
          }
          float st_segDist(vec2 p, vec2 a, vec2 b) {
            vec2 ab = b - a;
            float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
            return distance(p, a + ab * t);
          }
          ${PATH_DIST_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float snowMaskF = 1.0;
          {
            vec3 snowRaw = texture2D(tSnow, vWPos.xz * 0.04).rgb;
            vec3 snowCol = mix(snowRaw, vec3(0.90, 0.93, 0.99), 0.65) * vec3(0.98, 1.0, 1.06);
            vec3 iceCol = texture2D(tIce, vWPos.xz * 0.07).rgb;
            vec3 rockCol = texture2D(tRock, vWPos.xz * 0.05).rgb * vec3(0.85, 0.9, 1.05);
            vec3 pavCol = mix(texture2D(tPaving, vWPos.xz * 0.09).rgb, vec3(0.62, 0.66, 0.76), 0.55);
            vec3 pathCol = mix(texture2D(tPath, vWPos.xz * 0.11).rgb, vec3(0.85, 0.88, 0.95), 0.3);

            float slope = 1.0 - clamp(vWNormal.y, 0.0, 1.0);
            float rockMask = smoothstep(0.20, 0.38, slope);

            // Glace : lac gelé + fond de gorge (niveau proche de la glace)
            float lakeD = distance(vWPos.xz, uLake.xy);
            float lakeMask = 1.0 - smoothstep(uLake.z * 0.85, uLake.z + 5.0, lakeD);
            float gorgeFloorMask = smoothstep(uGorgeFloor + 3.2, uGorgeFloor + 1.0, vWPos.y);
            float iceNoise = (st_noise(vWPos.xz * 0.08) - 0.5) * 0.35;
            float iceMask = clamp(max(lakeMask, gorgeFloorMask) + iceNoise * lakeMask, 0.0, 1.0);
            iceMask *= 1.0 - smoothstep(0.30, 0.45, slope);

            // Pavés Fatui : plateau + rampe
            float pavMask = 1.0 - smoothstep(uPalace.z, uPalace.z + 10.0, distance(vWPos.xz, uPalace.xy));
            float rampPav = (1.0 - smoothstep(10.0, 15.0, abs(vWPos.x - uPalace.x)))
                          * smoothstep(-64.0, -72.0, vWPos.z) * (1.0 - smoothstep(-100.0, -106.0, vWPos.z));
            pavMask = max(pavMask, rampPav);
            pavMask *= 1.0 - smoothstep(0.28, 0.42, slope);

            vec3 albedo = mix(snowCol, rockCol, rockMask);
            albedo = mix(albedo, iceCol, iceMask);
            albedo = mix(albedo, pavCol, pavMask);

            // Pavés du village de Beryozka (place + rues)
            float townD = distance(vWPos.xz, uTown.xy);
            float townMask = (1.0 - smoothstep(uTown.z * 0.45, uTown.z, townD))
                           * (1.0 - smoothstep(0.28, 0.42, slope));
            vec3 vilCol = mix(texture2D(tPavingVillage, vWPos.xz * 0.10).rgb, vec3(0.70, 0.73, 0.81), 0.30);
            albedo = mix(albedo, vilCol, townMask);

            // Sentier damé par-dessus la neige (pas sur glace/pavés/village)
            float pathM = (1.0 - smoothstep(1.6, 3.4, st_pathDist(vWPos.xz)))
                        * (1.0 - iceMask) * (1.0 - pavMask) * (1.0 - rockMask) * (1.0 - townMask);
            albedo = mix(albedo, pathCol, pathM * 0.85);

            // Variation bleutée grande échelle + ombres de congères
            float dune = st_noise(vWPos.xz * 0.03);
            albedo *= mix(vec3(1.0), vec3(0.88, 0.93, 1.07), dune * 0.4 * (1.0 - pavMask));

            diffuseColor.rgb *= albedo;
            snowMaskF = (1.0 - rockMask) * (1.0 - iceMask) * (1.0 - pavMask) * (1.0 - townMask);
          }`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            // Micro-étincelles de neige : cellules scintillantes animées (rares)
            vec2 cell = floor(vWPos.xz * 7.0);
            float gh = st_hash(cell);
            float tw = sin(uTime * 2.2 + gh * 40.0) * 0.5 + 0.5;
            float glint = step(0.994, gh) * smoothstep(0.82, 1.0, tw);
            // Les étincelles ne brillent que face à la lumière rasante
            float facing = clamp(vWNormal.y, 0.0, 1.0);
            totalEmissiveRadiance += vec3(0.75, 0.85, 1.0) * glint * snowMaskF * facing * 0.38;
          }`,
        );
    };

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'snow-terrain';
  }

  update(dt: number): void {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
  }

  getHeight(x: number, z: number): number {
    return snowHeight(x, z);
  }
}
