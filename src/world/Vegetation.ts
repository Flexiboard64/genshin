import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HeightGrid, LAKE, noise2 } from './Terrain';
import { normalizeMeshyMaterials } from '../core/materials';

export interface Collider {
  x: number;
  z: number;
  r: number;
}

interface SpeciesSpec {
  key: string;
  count: number;
  targetHeight: number;
  minScale: number;
  maxScale: number;
  minSpacing: number;
  maxSlope: number;
  seed: number;
  /** Distribution en bosquets : bruit > threshold. */
  cluster?: { freq: number; threshold: number };
  /** Anneau autour du lac (ginkgo). */
  nearLake?: { inner: number; outer: number };
  /** Tolère la bande de plage. */
  allowBeach?: boolean;
  /** Préfère l'altitude (pins). */
  minHeight?: number;
  colliderR?: number;
  sink?: number;
  /** Amplitude du vent en cime (m). */
  windAmp?: number;
  /** Défaut true. False pour les buissons (économise la passe d'ombre). */
  castShadow?: boolean;
}

const SPECIES: SpeciesSpec[] = [
  {
    key: 'tree-oak', count: 42, targetHeight: 7.6, minScale: 0.85, maxScale: 1.3,
    minSpacing: 5.5, maxSlope: 0.3, seed: 101,
    cluster: { freq: 0.025, threshold: 0.52 }, colliderR: 0.55, windAmp: 0.35,
  },
  {
    key: 'tree-pine', count: 36, targetHeight: 9.2, minScale: 0.8, maxScale: 1.25,
    minSpacing: 5, maxSlope: 0.38, seed: 202,
    cluster: { freq: 0.03, threshold: 0.5 }, minHeight: 2, colliderR: 0.5, windAmp: 0.28,
  },
  {
    key: 'tree-ginkgo', count: 22, targetHeight: 6.4, minScale: 0.85, maxScale: 1.2,
    minSpacing: 6, maxSlope: 0.3, seed: 303,
    nearLake: { inner: LAKE.radius + 3, outer: LAKE.radius + 20 }, allowBeach: true,
    colliderR: 0.5, windAmp: 0.4,
  },
  {
    key: 'bush-round', count: 110, targetHeight: 1.15, minScale: 0.7, maxScale: 1.4,
    minSpacing: 2.6, maxSlope: 0.34, seed: 404, windAmp: 0.1, castShadow: false,
  },
  {
    key: 'bush-flower', count: 70, targetHeight: 1.3, minScale: 0.7, maxScale: 1.3,
    minSpacing: 2.8, maxSlope: 0.34, seed: 505, allowBeach: true, windAmp: 0.12,
    castShadow: false,
  },
  {
    key: 'rock-mossy', count: 40, targetHeight: 1.5, minScale: 0.6, maxScale: 1.8,
    minSpacing: 4, maxSlope: 0.55, seed: 606, allowBeach: true,
    colliderR: 0.8, sink: 0.18, windAmp: 0,
  },
  {
    key: 'rock-sharp', count: 30, targetHeight: 2.7, minScale: 0.7, maxScale: 1.7,
    minSpacing: 5, maxSlope: 0.6, seed: 707, allowBeach: true,
    colliderR: 1, sink: 0.25, windAmp: 0,
  },
];

/** RNG déterministe pour un placement reproductible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIND_PARS = /* glsl */ `
uniform float uTime;
uniform float uHeight;
uniform float uWindAmp;
`;

const WIND_DISPLACE = /* glsl */ `
{
  float hgt = clamp(transformed.y / uHeight, 0.0, 1.0);
  float bendAmt = hgt * hgt * uWindAmp;
  #ifdef USE_INSTANCING
    vec2 iph = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
  #else
    vec2 iph = vec2(0.0);
  #endif
  float sway = sin(uTime * 1.15 + iph.x * 0.31 + iph.y * 0.23) * 0.5 + 0.5;
  float gust = sin(uTime * 0.5 + iph.x * 0.045 + iph.y * 0.06) * 0.5 + 0.5;
  transformed.xz += vec2(0.82, 0.57) * (sway * 0.45 + gust * 0.75) * bendAmt;
}
`;

/** Arbres, buissons et rochers Meshy instanciés, posés sur le terrain. */
export class Vegetation {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private readonly time = { value: 0 };

  constructor(models: ReadonlyMap<string, GLTF>, grid: HeightGrid) {
    this.group.name = 'vegetation';
    for (const spec of SPECIES) {
      const gltf = models.get(spec.key);
      if (!gltf) {
        console.warn(`[Vegetation] asset manquant "${spec.key}" — espèce ignorée`);
        continue;
      }
      this.buildSpecies(spec, gltf, grid);
    }
  }

  private buildSpecies(spec: SpeciesSpec, gltf: GLTF, grid: HeightGrid): void {
    const rng = mulberry32(spec.seed);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    normalizeMeshyMaterials(root, 0.95);

    const box = new THREE.Box3().setFromObject(root);
    const srcHeight = Math.max(box.max.y - box.min.y, 0.01);
    const baseScale = spec.targetHeight / srcHeight;

    // Placement des instances
    const matrices: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const half = 195;
    const occupied = new Set<string>();

    const tryPlace = (x: number, z: number): boolean => {
      if (Math.abs(x) > half || Math.abs(z) > half) return false;
      const m = grid.masks(x, z);
      if (m.underwater > 0 || m.slope > spec.maxSlope) return false;
      if (!spec.allowBeach && m.beach > 0.55) return false;
      if (spec.minHeight !== undefined && m.height < spec.minHeight) return false;
      if (spec.cluster) {
        const n = noise2(x * spec.cluster.freq + spec.seed * 0.01, z * spec.cluster.freq);
        if (n < spec.cluster.threshold) return false;
      }
      if (Math.hypot(x, z) < 6) return false;
      // Espacement minimal via grille de cellules
      const cell = `${Math.floor(x / spec.minSpacing)},${Math.floor(z / spec.minSpacing)}`;
      if (occupied.has(cell)) return false;
      occupied.add(cell);

      const randS = spec.minScale + rng() * (spec.maxScale - spec.minScale);
      const s = baseScale * randS;
      // Les GLB Meshy sont centrés à l'origine : remonter de -min.y × s pour poser la base au sol
      pos.set(x, m.height - box.min.y * s - (spec.sink ?? 0) * randS, z);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      scl.setScalar(s);
      m4.compose(pos, q, scl);
      matrices.push(m4.clone());
      if (spec.colliderR) {
        this.colliders.push({ x, z, r: spec.colliderR * randS });
      }
      return true;
    };

    let attempts = 0;
    while (matrices.length < spec.count && attempts < spec.count * 60) {
      attempts++;
      if (spec.nearLake) {
        const angle = rng() * Math.PI * 2;
        const dist = spec.nearLake.inner + rng() * (spec.nearLake.outer - spec.nearLake.inner);
        tryPlace(LAKE.x + Math.cos(angle) * dist, LAKE.z + Math.sin(angle) * dist);
      } else {
        tryPlace((rng() * 2 - 1) * half, (rng() * 2 - 1) * half);
      }
    }

    // Un InstancedMesh par sous-mesh du GLB (même matrices pour tous)
    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    for (const src of meshes) {
      const geometry = src.geometry.clone().applyMatrix4(src.matrixWorld);
      const material = (Array.isArray(src.material) ? src.material[0] : src.material).clone();
      this.injectWind(material, spec.targetHeight, spec.windAmp ?? 0.2);
      const instanced = new THREE.InstancedMesh(geometry, material, matrices.length);
      for (let i = 0; i < matrices.length; i++) instanced.setMatrixAt(i, matrices[i]);
      instanced.instanceMatrix.needsUpdate = true;
      instanced.castShadow = spec.castShadow !== false;
      instanced.receiveShadow = true;
      instanced.frustumCulled = false;
      instanced.name = `${spec.key}-instanced`;
      this.group.add(instanced);
    }
  }

  private injectWind(material: THREE.Material, height: number, amp: number): void {
    if (amp <= 0) return;
    const time = this.time;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time as unknown as THREE.IUniform;
      shader.uniforms.uHeight = { value: height };
      shader.uniforms.uWindAmp = { value: amp };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WIND_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_DISPLACE}`);
    };
    // Clé de programme distincte par espèce (hauteur/amplitude différentes)
    material.customProgramCacheKey = () => `wind-${height.toFixed(2)}-${amp.toFixed(2)}`;
  }

  update(elapsed: number): void {
    this.time.value = elapsed;
  }
}
