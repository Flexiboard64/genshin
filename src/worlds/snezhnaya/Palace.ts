import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { normalizeMeshyMaterials } from '../../core/materials';
import type { Collider } from '../../world/Vegetation';
import { GORGE, gorgeCenterX, snowHeight } from './SnowTerrain';

/** Une marche de l'escalier monumental (instanciée). */
const STEP_COUNT = 42;
const STEP_DEPTH = 0.9;
const STEP_WIDTH = 14.5;
const STEP_HEIGHT = 1.6;
/** Base sud de l'escalier (z), il monte vers le nord (z décroissants). */
const STAIR_Z_BASE = -64;

/**
 * Hauteur PRATICABLE de l'escalier : paliers quantifiés identiques aux
 * marches instanciées, -Infinity hors emprise. Intégrée à snezhGround pour
 * que le joueur monte les marches au lieu de traverser l'escalier.
 * (Échantillonne snowHeight, jamais snezhGround : pas de boucle.)
 */
export function stairsHeight(x: number, z: number): number {
  if (Math.abs(x) > STEP_WIDTH / 2) return Number.NEGATIVE_INFINITY;
  const d = STAIR_Z_BASE - z;
  if (d < 0 || d >= STEP_COUNT * STEP_DEPTH) return Number.NEGATIVE_INFINITY;
  const i = Math.floor(d / STEP_DEPTH);
  return snowHeight(0, STAIR_Z_BASE - (i + 1) * STEP_DEPTH) + 0.09;
}

/**
 * Composition du palais Fatui (plateau nord) + camp forestier + props de
 * la gorge (ponts de glace, ruines, poteaux du promontoire) + braseros à
 * flammes animées et lumières chaudes en contraste avec le froid ambiant.
 */

interface PlaceOpts {
  rotY?: number;
  targetHeight: number;
  sink?: number;
  stretchX?: number;
  colliderR?: number;
  /** Lisibilité crépusculaire : léger auto-éclairage par la texture de base. */
  readable?: boolean;
}

interface Flame {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  phase: number;
  baseScale: number;
}

const FLAME_VERT = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float sway = sin(uTime * 7.0 + uPhase + p.y * 6.0) * 0.12 * p.y;
  p.x += sway;
  p.z += sway * 0.6;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
float fl_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fl_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(fl_hash(i), fl_hash(i + vec2(1.0, 0.0)), u.x),
    mix(fl_hash(i + vec2(0.0, 1.0)), fl_hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}
void main() {
  float n = fl_noise(vec2(vUv.x * 5.0 + uPhase, vUv.y * 7.0 - uTime * 3.2));
  float body = smoothstep(0.15, 0.55, vUv.y + n * 0.35) * (1.0 - smoothstep(0.55, 1.0, vUv.y + n * 0.3));
  float core = smoothstep(0.3, 0.0, abs(vUv.x - 0.5));
  vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.4), core * (1.0 - vUv.y));
  float a = body * core * 1.6;
  if (a < 0.02) discard;
  gl_FragColor = vec4(col * 3.0, a);
}
`;

export class Palace {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  private readonly flames: Flame[] = [];
  private readonly flameMaterial: THREE.ShaderMaterial;
  private time = 0;

  constructor(
    private readonly models: ReadonlyMap<string, GLTF>,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly pavingTexture: THREE.Texture | null = null,
  ) {
    this.group.name = 'palace';
    this.flameMaterial = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: 0 },
      },
    });

    // ——— Plateau : façade cathédrale, tours, murs, escalier, statue ———
    this.place('palace-facade', 0, -134, { targetHeight: 19, sink: 0.5, colliderR: 9, readable: true });
    // Éclairage architectural : 2 uplights bleu froid sur la façade (style Fatui)
    for (const ux of [-10, 10]) {
      const up = new THREE.PointLight(0x9fc8ff, 8, 34, 1.7);
      up.position.set(ux, this.groundAt(ux, -124) + 2.5, -124);
      this.group.add(up);
    }
    // Remplissage froid large : la face sud du plateau reste lisible de loin
    // (sinon la falaise noyée dans le brouillard fait « flotter » le palais)
    const cliffFill = new THREE.PointLight(0x8fb4e8, 9, 90, 1.5);
    cliffFill.position.set(0, 12, -86);
    this.group.add(cliffFill);
    this.place('palace-tower', -17, -129, { targetHeight: 26, sink: 0.4, colliderR: 4.5, readable: true });
    this.place('palace-tower', 17, -129, { targetHeight: 26, sink: 0.4, colliderR: 4.5, readable: true });
    for (const [wx, wz, rot] of [
      [-25, -124, Math.PI / 2],
      [-25, -110, Math.PI / 2],
      [25, -124, Math.PI / 2],
      [25, -110, Math.PI / 2],
      [-12, -141, 0],
      [12, -141, 0],
    ] as const) {
      this.place('palace-wall', wx, wz, { targetHeight: 7.5, rotY: rot, sink: 0.3, colliderR: 4, readable: true });
    }
    this.place('palace-gate-arch', 0, -101.5, { targetHeight: 10, sink: 0.3, colliderR: 2.2, readable: true });
    // Obélisques Fatui : gardiens de l'arche + repère du promontoire
    this.place('fatui-obelisk', -6.5, -99.5, { targetHeight: 5.5, sink: 0.2, colliderR: 1, readable: true });
    this.place('fatui-obelisk', 6.5, -99.5, { targetHeight: 5.5, sink: 0.2, colliderR: 1, readable: true });
    this.place('fatui-obelisk', 69.5, -7.5, { targetHeight: 4.2, rotY: 0.6, sink: 0.2, colliderR: 0.8, readable: true });
    this.monumentalStairs();
    this.place('statue-tsaritsa', 0, -120, { targetHeight: 4.8, sink: 0.15, colliderR: 1.4, readable: true });
    // Uplight froid sur la statue (sinon silhouette noire au crépuscule)
    const statueLight = new THREE.PointLight(0xa8c8ff, 9, 20, 1.7);
    statueLight.position.set(0, this.groundAt(0, -114) + 2.5, -114);
    this.group.add(statueLight);

    // Bannières bleues Fatui : façade + le long de l'escalier
    for (const [bx, bz, h] of [
      [-9, -126.5, 5.2],
      [9, -126.5, 5.2],
      [-7.6, -72, 4.4],
      [7.6, -72, 4.4],
      [-7.6, -92, 4.4],
      [7.6, -92, 4.4],
    ] as const) {
      this.place('fatui-banner', bx, bz, { targetHeight: h, sink: 0.1 });
    }

    // Braseros : base de l'escalier + place du palais (lumières chaudes)
    this.brazier(-7, -65);
    this.brazier(7, -65);
    this.brazier(-7.5, -107.5);
    this.brazier(7.5, -107.5);

    // Lampadaires : escalier (2 allumés) + sentier + place
    this.lantern(6.5, -63.5, true);
    this.lantern(-6.5, -63.5, true);
    this.lantern(6.5, -103, false);
    this.lantern(-6.5, -103, false);
    this.lantern(13, -118, false);
    this.lantern(-13, -118, false);
    this.lantern(44, -16, false);
    this.lantern(24, -31, false);
    this.lantern(6, -46, false);
    this.lantern(-2, -58, false);

    // ——— Camp Fatui forestier (ouest) ———
    this.place('fatui-tent', -58, -55, { targetHeight: 3.4, rotY: 0.7, sink: 0.15, colliderR: 2.4 });
    this.place('fatui-tent', -47, -46, { targetHeight: 3.2, rotY: -2.1, sink: 0.15, colliderR: 2.2 });
    this.place('fatui-banner', -53, -59, { targetHeight: 4.6, sink: 0.1 });
    for (const [cx, cz, r] of [
      [-55, -50, 0.4],
      [-53.6, -49.2, 2.2],
      [-50, -57, 1.1],
      [-60, -52, -0.8],
      [-49, -43, 2.9],
    ] as const) {
      this.place('fatui-crate', cx, cz, { targetHeight: 1.1, rotY: r, sink: 0.06, colliderR: 0.7 });
    }
    for (const [bx, bz, r] of [
      [-44, -54, 1.2],
      [-61, -46, -0.5],
      [-52, -38, 0.2],
    ] as const) {
      this.place('fatui-barrier', bx, bz, { targetHeight: 1.3, rotY: r, sink: 0.08, colliderR: 1.2 });
    }

    // ——— Promontoire : poteaux bois face à la gorge (screen 2) ———
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const px = 66 + t * 16;
      const pz = -16 - t * 12;
      this.place('wood-post-rail', px, pz, {
        targetHeight: 1.15,
        rotY: Math.atan2(16, -12) + Math.PI / 2,
        sink: 0.1,
      });
    }

    // ——— Gorge : ponts de glace, arche en ruine, piliers ———
    this.iceBridge(-75);
    this.iceBridge(24);
    const archZ = 42;
    this.place('stone-arch-ruin', gorgeCenterX(archZ), archZ, {
      targetHeight: 7.5,
      rotY: Math.PI / 2,
      sink: 0.6,
      colliderR: 2,
    });
    this.place('ruin-pillar-snow', gorgeCenterX(-50) - 6, -50, { targetHeight: 4.5, rotY: 0.4, sink: 0.4, colliderR: 1.1 });
    this.place('ruin-pillar-snow', gorgeCenterX(-8) + 5, -8, { targetHeight: 3.6, rotY: 2.1, sink: 0.4, colliderR: 1 });
    this.place('ruin-pillar-snow', gorgeCenterX(70) - 7, 70, { targetHeight: 5, rotY: 1.2, sink: 0.5, colliderR: 1.2 });
    this.place('ruin-pillar-snow', 66, -44, { targetHeight: 3.2, rotY: -0.7, sink: 0.3, colliderR: 0.9 });
  }

  /** Pont de glace enjambant la gorge à une coordonnée z. */
  private iceBridge(z: number): void {
    const cx = gorgeCenterX(z);
    const rimY = Math.max(
      this.groundAt(cx - GORGE.halfWidth - 6, z),
      this.groundAt(cx + GORGE.halfWidth + 6, z),
    );
    const span = GORGE.halfWidth * 2 + 14;
    this.place('ice-bridge', cx, z, {
      targetHeight: 2.6,
      rotY: Math.PI / 2,
      stretchX: span / 14,
      sink: -0.5,
      yOverride: rimY + 0.6,
    } as PlaceOpts & { yOverride: number });
  }

  /**
   * Escalier monumental procédural : 42 marches pavées (~0,38 m de
   * contremarche) suivant la rampe du plateau + garde-corps latéraux
   * (1 draw call pour les marches). Les hauteurs viennent de snowHeight
   * (jamais snezhGround, qui inclut désormais stairsHeight : boucle).
   */
  private monumentalStairs(): void {
    const material = new THREE.MeshStandardMaterial({
      map: this.pavingTexture,
      color: 0xbcc8dd,
      roughness: 0.82,
      metalness: 0.05,
    });
    if (this.pavingTexture) {
      this.pavingTexture.wrapS = THREE.RepeatWrapping;
      this.pavingTexture.wrapT = THREE.RepeatWrapping;
    }

    const stepGeo = new THREE.BoxGeometry(STEP_WIDTH, STEP_HEIGHT, STEP_DEPTH + 0.25);
    const steps = new THREE.InstancedMesh(stepGeo, material, STEP_COUNT);
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < STEP_COUNT; i++) {
      const zBack = STAIR_Z_BASE - (i + 1) * STEP_DEPTH;
      const top = snowHeight(0, zBack) + 0.09;
      pos.set(0, top - STEP_HEIGHT / 2, STAIR_Z_BASE - (i + 0.5) * STEP_DEPTH);
      m4.compose(pos, q, one);
      steps.setMatrixAt(i, m4);
    }
    steps.instanceMatrix.needsUpdate = true;
    steps.castShadow = true;
    steps.receiveShadow = true;
    steps.name = 'monumental-stairs';
    this.group.add(steps);

    // Garde-corps latéraux suivant la pente
    const railGeo = new THREE.BoxGeometry(0.9, 1.15, 39);
    const midY = (snowHeight(0, STAIR_Z_BASE) + snowHeight(0, -102)) / 2;
    const pitch = Math.atan((snowHeight(0, -102) - snowHeight(0, STAIR_Z_BASE)) / 38);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, material);
      rail.position.set(side * (STEP_WIDTH / 2 + 0.55), midY + 0.35, -83);
      rail.rotation.x = pitch;
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.group.add(rail);
      this.colliders.push({ x: side * (STEP_WIDTH / 2 + 0.55), z: -83, r: 1.0 });
    }
  }

  private place(
    key: string,
    x: number,
    z: number,
    opts: PlaceOpts & { yOverride?: number },
  ): THREE.Object3D | null {
    const gltf = this.models.get(key);
    if (!gltf) {
      console.warn(`[Palace] asset manquant "${key}" — ignoré`);
      return null;
    }
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    normalizeMeshyMaterials(root, 0.95);
    const box = new THREE.Box3().setFromObject(root);
    const srcHeight = Math.max(box.max.y - box.min.y, 0.01);
    const s = opts.targetHeight / srcHeight;
    root.scale.setScalar(s);
    if (opts.stretchX) root.scale.x *= opts.stretchX;
    root.rotation.y = opts.rotY ?? 0;
    const groundY = opts.yOverride ?? this.groundAt(x, z);
    root.position.set(x, groundY - box.min.y * s - (opts.sink ?? 0), z);
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    if (opts.readable) {
      // Repères lointains : la texture de base en emissive lève la silhouette
      // noire au crépuscule (sinon les bâtiments semblent flotter dans le ciel)
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (!std.isMeshStandardMaterial) continue;
          if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
          std.emissive = new THREE.Color(0xffffff);
          std.emissiveIntensity = 0.27;
        }
      });
    }
    this.group.add(root);
    if (opts.colliderR) this.colliders.push({ x, z, r: opts.colliderR });
    return root;
  }

  /** Brasero + flamme shader + point light chaude (contraste froid/chaud). */
  private brazier(x: number, z: number): void {
    const model = this.place('fatui-brazier', x, z, { targetHeight: 1.6, sink: 0.08, colliderR: 0.7 });
    const topY = this.groundAt(x, z) + 1.55;

    const flameGeo = new THREE.ConeGeometry(0.55, 2.2, 8, 6, true);
    flameGeo.translate(0, 0.85, 0);
    const flameMat = this.flameMaterial.clone();
    flameMat.uniforms.uPhase.value = x * 1.7 + z * 0.9;
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x, topY - (model ? 0 : 1.55), z);
    flame.renderOrder = 7;
    this.group.add(flame);

    const light = new THREE.PointLight(0xff9a3c, 11, 30, 1.8);
    light.position.set(x, topY + 0.8, z);
    this.group.add(light);
    this.flames.push({ mesh: flame, light, phase: x * 1.7 + z * 0.9, baseScale: 1 });
  }

  private lantern(x: number, z: number, withLight: boolean): void {
    this.place('fatui-lantern-post', x, z, { targetHeight: 3.3, sink: 0.1, colliderR: 0.35 });
    if (!withLight) return;
    const light = new THREE.PointLight(0xffc06a, 4, 16, 1.9);
    light.position.set(x, this.groundAt(x, z) + 3.1, z);
    this.group.add(light);
    // Vacille doucement via une flamme factice invisible
    this.flames.push({
      mesh: new THREE.Mesh(),
      light,
      phase: x * 2.3 + z,
      baseScale: 0,
    });
  }

  update(dt: number): void {
    this.time += dt;
    this.flameMaterial.uniforms.uTime.value = this.time;
    for (const f of this.flames) {
      const flicker = 0.85 + 0.15 * Math.sin(this.time * 9 + f.phase) * Math.sin(this.time * 5.3 + f.phase * 2.7);
      f.light.intensity = (f.baseScale > 0 ? 11 : 4) * flicker;
      if (f.baseScale > 0) {
        const s = f.baseScale * (0.92 + 0.14 * Math.sin(this.time * 8.2 + f.phase));
        f.mesh.scale.set(s, s * (1.02 + 0.1 * Math.sin(this.time * 6.1 + f.phase)), s);
        const mat = f.mesh.material as THREE.ShaderMaterial;
        if (mat.uniforms?.uTime) mat.uniforms.uTime.value = this.time;
      }
    }
  }
}
