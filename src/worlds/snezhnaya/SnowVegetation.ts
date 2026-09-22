import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HeightGrid, noise2 } from '../../world/Terrain';
import { normalizeMeshyMaterials } from '../../core/materials';
import type { Collider } from '../../world/Vegetation';
import {
  GORGE,
  PEAK,
  RAVINE,
  SPAWN,
  crevasseIntensity,
  gorgeCenterX,
  gorgeDist,
  pathDist,
  ravineCenterX,
  snowMasks,
} from './SnowTerrain';

interface SnowSpecies {
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
  /** Placement sur les corniches de la gorge. */
  gorgeRim?: { inner: number; outer: number };
  /** Préférence fissures lumineuses (intensité minimale de crevasse). */
  nearCrevasse?: number;
  colliderR?: number;
  sink?: number;
  windAmp?: number;
  castShadow?: boolean;
  /** Lueur émissive cyan (cristaux, fleurs de givre → bloom). */
  emissive?: { color: number; intensity: number };
}

const SPECIES: SnowSpecies[] = [
  {
    key: 'tree-snow-pine-a', count: 45, targetHeight: 9.5, minScale: 0.8, maxScale: 1.3,
    minSpacing: 5, maxSlope: 0.34, seed: 11,
    cluster: { freq: 0.022, threshold: 0.5 }, colliderR: 0.55, windAmp: 0.22,
  },
  {
    key: 'tree-snow-pine-b', count: 40, targetHeight: 7.8, minScale: 0.8, maxScale: 1.25,
    minSpacing: 4.6, maxSlope: 0.36, seed: 22,
    cluster: { freq: 0.026, threshold: 0.48 }, colliderR: 0.5, windAmp: 0.25,
  },
  {
    key: 'tree-snow-fir-c', count: 26, targetHeight: 11, minScale: 0.85, maxScale: 1.2,
    minSpacing: 6, maxSlope: 0.32, seed: 33,
    cluster: { freq: 0.02, threshold: 0.55 }, colliderR: 0.6, windAmp: 0.18,
  },
  {
    key: 'tree-bare-frozen', count: 26, targetHeight: 7, minScale: 0.8, maxScale: 1.3,
    minSpacing: 6.5, maxSlope: 0.4, seed: 44, colliderR: 0.45, windAmp: 0.08,
  },
  {
    key: 'bush-snow', count: 85, targetHeight: 1.2, minScale: 0.7, maxScale: 1.5,
    minSpacing: 2.6, maxSlope: 0.36, seed: 55, windAmp: 0.08, castShadow: false,
  },
  {
    key: 'ice-crystal-cluster', count: 42, targetHeight: 2.2, minScale: 0.7, maxScale: 1.6,
    minSpacing: 3.4, maxSlope: 0.5, seed: 66, nearCrevasse: 0.15, colliderR: 0.7,
    emissive: { color: 0x4fc8f5, intensity: 0.5 },
  },
  {
    key: 'ice-shard-spike', count: 38, targetHeight: 3.4, minScale: 0.6, maxScale: 1.7,
    minSpacing: 3.8, maxSlope: 0.6, seed: 77, nearCrevasse: 0.05, colliderR: 0.6,
    sink: 0.3, emissive: { color: 0x3fb0e8, intensity: 0.3 },
  },
  {
    key: 'rock-snow-a', count: 42, targetHeight: 1.8, minScale: 0.6, maxScale: 1.9,
    minSpacing: 4, maxSlope: 0.55, seed: 88, colliderR: 0.85, sink: 0.2, windAmp: 0,
  },
  {
    key: 'rock-ice-cliff', count: 16, targetHeight: 11, minScale: 0.8, maxScale: 1.5,
    minSpacing: 12, maxSlope: 1, seed: 99, gorgeRim: { inner: 2, outer: 16 },
    colliderR: 2.6, sink: 1.6, windAmp: 0,
  },
  {
    key: 'snow-drift', count: 70, targetHeight: 0.9, minScale: 0.8, maxScale: 2.2,
    minSpacing: 4, maxSlope: 0.3, seed: 111, windAmp: 0, castShadow: false, sink: 0.15,
  },
  {
    key: 'icicle-cluster', count: 44, targetHeight: 2.6, minScale: 0.7, maxScale: 1.6,
    minSpacing: 3, maxSlope: 1, seed: 122, gorgeRim: { inner: -2, outer: 10 },
    sink: 0.4, windAmp: 0, castShadow: false,
    emissive: { color: 0x66c8f0, intensity: 0.22 },
  },
  {
    key: 'frozen-log', count: 18, targetHeight: 0.9, minScale: 0.8, maxScale: 1.4,
    minSpacing: 6, maxSlope: 0.3, seed: 133, sink: 0.12, windAmp: 0,
  },
  {
    key: 'cryo-flower', count: 34, targetHeight: 0.7, minScale: 0.8, maxScale: 1.5,
    minSpacing: 3, maxSlope: 0.34, seed: 144, nearCrevasse: 0.08, windAmp: 0.06,
    castShadow: false, emissive: { color: 0x8fdcf5, intensity: 0.65 },
  },
];

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
  float sway = sin(uTime * 1.05 + iph.x * 0.31 + iph.y * 0.23) * 0.5 + 0.5;
  float gust = sin(uTime * 0.45 + iph.x * 0.045 + iph.y * 0.06) * 0.5 + 0.5;
  transformed.xz += vec2(0.85, 0.5) * (sway * 0.4 + gust * 0.8) * bendAmt;
}
`;

/** Végétation et rochers enneigés de Snezhnaya, instanciés et posés sur le terrain. */
export class SnowVegetation {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private readonly time = { value: 0 };

  constructor(models: ReadonlyMap<string, GLTF>, private readonly grid: HeightGrid) {
    this.group.name = 'snow-vegetation';
    for (const spec of SPECIES) {
      const gltf = models.get(spec.key);
      if (!gltf) {
        console.warn(`[SnowVegetation] asset manquant "${spec.key}" — espèce ignorée`);
        continue;
      }
      this.buildSpecies(spec, gltf);
    }
  }

  private buildSpecies(spec: SnowSpecies, gltf: GLTF): void {
    const rng = mulberry32(spec.seed);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    normalizeMeshyMaterials(root, 0.95);

    const box = new THREE.Box3().setFromObject(root);
    const srcHeight = Math.max(box.max.y - box.min.y, 0.01);
    const baseScale = spec.targetHeight / srcHeight;

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
      const m = snowMasks(this.grid, x, z);
      const gd = gorgeDist(x, z);

      if (spec.gorgeRim) {
        // Corniches : anneau autour des parois de la gorge
        const d = gd - GORGE.halfWidth;
        if (d < spec.gorgeRim.inner || d > spec.gorgeRim.outer) return false;
      } else {
        // Hors gorge (sauf shards/cristaux qui tolèrent le fond) et hors palais
        if (m.gorge > 0.15 && !spec.nearCrevasse) return false;
        if (m.palace > 0.05) return false;
        if (spec.nearCrevasse === undefined && m.crevasse > 0.25) return false;
      }
      if (m.slope > spec.maxSlope) return false;
      // Jamais dans le village, ni sur le piton de planage, ni dans le ravin
      if (m.town > 0.04) return false;
      if (Math.hypot(x - PEAK.x, z - PEAK.z) < PEAK.radius * 0.95) return false;
      if (Math.abs(x - ravineCenterX(z)) < RAVINE.halfWidth + 3 && z > -29 && z < 51) return false;
      if (spec.nearCrevasse !== undefined && crevasseIntensity(x, z) < spec.nearCrevasse && gd > GORGE.halfWidth + 12) return false;
      if (spec.cluster) {
        // Forêt des Murmures : le seuil de bosquet est assoupli → sapins denses
        const threshold = m.forest > 0.35 ? spec.cluster.threshold - 0.34 : spec.cluster.threshold;
        const n = noise2(x * spec.cluster.freq + spec.seed * 0.01, z * spec.cluster.freq);
        if (n < threshold) return false;
      }
      // Dégager le promontoire d'arrivée et le sentier
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 7) return false;
      if (!spec.gorgeRim && pathDist(x, z) < 2.6 && spec.colliderR) return false;

      const cell = `${Math.floor(x / spec.minSpacing)},${Math.floor(z / spec.minSpacing)}`;
      if (occupied.has(cell)) return false;
      occupied.add(cell);

      const randS = spec.minScale + rng() * (spec.maxScale - spec.minScale);
      const s = baseScale * randS;
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
    while (matrices.length < spec.count && attempts < spec.count * 70) {
      attempts++;
      if (spec.gorgeRim) {
        const z = (rng() * 2 - 1) * 190;
        const side = rng() < 0.5 ? -1 : 1;
        const gx = gorgeCenterX(z) + side * (GORGE.halfWidth + spec.gorgeRim.inner + rng() * (spec.gorgeRim.outer - spec.gorgeRim.inner));
        tryPlace(gx, z);
      } else {
        tryPlace((rng() * 2 - 1) * half, (rng() * 2 - 1) * half);
      }
    }

    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    for (const src of meshes) {
      const geometry = src.geometry.clone().applyMatrix4(src.matrixWorld);
      const material = (Array.isArray(src.material) ? src.material[0] : src.material).clone();
      if (spec.emissive && 'emissive' in material) {
        const std = material as THREE.MeshStandardMaterial;
        std.emissive = new THREE.Color(spec.emissive.color);
        std.emissiveIntensity = spec.emissive.intensity;
      }
      this.injectWind(material, spec.targetHeight, spec.windAmp ?? 0.15);
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
    material.customProgramCacheKey = () => `snow-wind-${height.toFixed(2)}-${amp.toFixed(2)}`;
  }

  update(elapsed: number): void {
    this.time.value = elapsed;
  }
}
