import * as THREE from 'three';
import { HeightGrid, LAKE, noise2 } from './Terrain';

const CELL = 1.6;
const BLADE_COUNT = 3;
const FLOWER_COUNT = 2200;
const FADE_NEAR = 46;
const FADE_FAR = 60;
const PUSH_RADIUS = 1.25;

const WIND_VERT_BODY = /* glsl */ `
  float dist = distance(uCamPos.xz, iPos.xz);
  float fade = 1.0 - smoothstep(${FADE_NEAR}.0, ${FADE_FAR}.0, dist);
  vec3 local = position * iScale * fade;
  float c = cos(iRot);
  float s = sin(iRot);
  local = vec3(local.x * c - local.z * s, local.y, local.x * s + local.z * c);
  vec3 wp = iPos + local;

  float sway = sin(uTime * 1.7 + iPhase + iPos.x * 0.24 + iPos.z * 0.17);
  float gust = sin(uTime * 0.6 + iPos.x * 0.045 + iPos.z * 0.06) * 0.5 + 0.5;
  float bend = sway * 0.14 + gust * 0.12 + 0.03;
  vec2 wind = vec2(0.82, 0.57) * bend;

  vec2 toP = iPos.xz - uPlayerPos.xz;
  float pd = length(toP);
  vec2 push = vec2(0.0);
  if (pd < ${PUSH_RADIUS} && pd > 0.0001) {
    push = (toP / pd) * (${PUSH_RADIUS} - pd) * 0.85;
  }
  float hf = aHeight * aHeight;
  vec2 total = wind + push;
  wp.xz += total * hf * iScale;
  wp.y -= dot(total, total) * 0.30 * hf * iScale;
`;

const GRASS_VERT = /* glsl */ `
attribute float aHeight;
attribute float aShade;
attribute vec3 iPos;
attribute float iScale;
attribute float iRot;
attribute float iTint;
attribute float iPhase;
uniform float uTime;
uniform vec3 uPlayerPos;
uniform vec3 uCamPos;
varying float vLight;
varying float vTint;
#include <fog_pars_vertex>
void main() {
  vTint = iTint;
  ${WIND_VERT_BODY}
  vLight = (0.72 + 0.38 * aHeight) * mix(0.88, 1.1, aShade);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const GRASS_FRAG = /* glsl */ `
uniform vec3 uBaseCol;
uniform vec3 uTipCol;
varying float vLight;
varying float vTint;
#include <fog_pars_fragment>
void main() {
  vec3 col = mix(uBaseCol, uTipCol, vTint);
  gl_FragColor = vec4(col * vLight, 1.0);
  #include <fog_fragment>
}
`;

const FLOWER_VERT = /* glsl */ `
attribute float aHeight;
attribute vec3 iPos;
attribute float iScale;
attribute float iRot;
attribute float iTint;
attribute float iPhase;
attribute vec3 iColor;
uniform float uTime;
uniform vec3 uPlayerPos;
uniform vec3 uCamPos;
varying vec3 vColor;
varying float vHeight;
#include <fog_pars_vertex>
void main() {
  vColor = iColor;
  vHeight = aHeight;
  ${WIND_VERT_BODY}
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FLOWER_FRAG = /* glsl */ `
uniform vec3 uStemCol;
varying vec3 vColor;
varying float vHeight;
#include <fog_pars_fragment>
void main() {
  // Tige verte en bas, pétale coloré en haut
  vec3 col = mix(uStemCol * 0.8, vColor, smoothstep(0.55, 0.75, vHeight));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function buildTuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const heights: number[] = [];
  const shades: number[] = [];
  for (let b = 0; b < BLADE_COUNT; b++) {
    const angle = (b / BLADE_COUNT) * Math.PI + hash1(b * 7.13) * 0.6;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const w = 0.055 + hash1(b * 3.7) * 0.03;
    const lean = 0.10 + hash1(b * 5.1) * 0.12;
    const shade = 0.75 + hash1(b * 11.3) * 0.25;
    // Triangle : base gauche, base droite, pointe (dans le plan de la lame, inclinée)
    const verts: Array<[number, number, number]> = [
      [-w, 0, 0],
      [w, 0, 0],
      [lean, 1, 0],
    ];
    for (const [x, y, z] of verts) {
      positions.push(x * ca - z * sa, y, x * sa + z * ca);
      heights.push(y);
      shades.push(shade);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  geometry.setAttribute('aShade', new THREE.Float32BufferAttribute(shades, 1));
  return geometry;
}

function buildFlowerGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const heights: number[] = [];
  const indices: number[] = [];
  // Deux quads croisés
  for (let q = 0; q < 2; q++) {
    const angle = (q / 2) * Math.PI;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const w = 0.16;
    const base = q * 4;
    const verts: Array<[number, number, number]> = [
      [-w, 0, 0],
      [w, 0, 0],
      [w, 1, 0],
      [-w, 1, 0],
    ];
    for (const [x, y, z] of verts) {
      positions.push(x * ca - z * sa, y, x * sa + z * ca);
      heights.push(y);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  geometry.setIndex(indices);
  return geometry;
}

const FLOWER_PALETTE = [
  new THREE.Color(0xf5efe0),
  new THREE.Color(0xf2d45c),
  new THREE.Color(0xc9a7e8),
  new THREE.Color(0xef9fb8),
];

/** Herbe instanciée animée par le vent + fleurs sauvages. Un draw call par couche. */
export class Grass {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly playerPos = { value: new THREE.Vector3() };
  private readonly camPos = { value: new THREE.Vector3() };

  constructor(grid: HeightGrid) {
    this.group.name = 'grass';
    this.buildGrass(grid);
    this.buildFlowers(grid);
  }

  private makeSharedUniforms(uniforms: Record<string, THREE.IUniform>): void {
    // UniformsUtils.merge clone les valeurs : réinjecter les références partagées.
    uniforms.uTime = this.time as unknown as THREE.IUniform;
    uniforms.uPlayerPos = this.playerPos as unknown as THREE.IUniform;
    uniforms.uCamPos = this.camPos as unknown as THREE.IUniform;
  }

  private grassMaterial(): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uBaseCol: { value: new THREE.Color(0x2e6428) },
          uTipCol: { value: new THREE.Color(0x9fd06e) },
        },
      ]),
      fog: true,
      side: THREE.DoubleSide,
    });
    this.makeSharedUniforms(material.uniforms);
    return material;
  }

  private buildGrass(grid: HeightGrid): void {
    const geometry = buildTuftGeometry();
    const half = 200;
    const positions: number[] = [];
    const scales: number[] = [];
    const rots: number[] = [];
    const tints: number[] = [];
    const phases: number[] = [];

    const cells = Math.floor((half * 2) / CELL);
    for (let cz = 0; cz < cells; cz++) {
      for (let cx = 0; cx < cells; cx++) {
        const seed = cz * 4096 + cx;
        const h0 = hash1(seed * 1.31);
        if (h0 > 0.78) continue;
        const x = -half + (cx + hash1(seed * 2.71)) * CELL;
        const z = -half + (cz + hash1(seed * 3.97)) * CELL;
        const m = grid.masks(x, z);
        if (m.underwater > 0 || m.slope > 0.32 || m.beach > 0.3) continue;
        if (m.lakeDist < LAKE.radius + 2) continue;
        if (Math.hypot(x, z) < 3.5) continue;
        // Prairies plus ou moins denses
        const density = noise2(x * 0.03 + 11.1, z * 0.03 + 5.7);
        if (hash1(seed * 5.23) > density * 1.5) continue;

        positions.push(x, m.height - 0.02, z);
        scales.push(0.3 + hash1(seed * 6.17) * 0.32);
        rots.push(hash1(seed * 7.91) * Math.PI * 2);
        tints.push(hash1(seed * 8.53));
        phases.push(hash1(seed * 9.47) * Math.PI * 2);
      }
    }

    const count = scales.length;
    geometry.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('iScale', new THREE.InstancedBufferAttribute(new Float32Array(scales), 1));
    geometry.setAttribute('iRot', new THREE.InstancedBufferAttribute(new Float32Array(rots), 1));
    geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(tints), 1));
    geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(new Float32Array(phases), 1));

    const instanced = new THREE.InstancedMesh(geometry, this.grassMaterial(), count);
    instanced.frustumCulled = false;
    instanced.castShadow = false;
    instanced.receiveShadow = false;
    this.group.add(instanced);
  }

  private buildFlowers(grid: HeightGrid): void {
    const geometry = buildFlowerGeometry();
    const positions: number[] = [];
    const scales: number[] = [];
    const rots: number[] = [];
    const tints: number[] = [];
    const phases: number[] = [];
    const colors: number[] = [];

    let placed = 0;
    for (let attempt = 0; attempt < FLOWER_COUNT * 14 && placed < FLOWER_COUNT; attempt++) {
      const seed = attempt * 13.37;
      const x = (hash1(seed * 1.1) - 0.5) * 380;
      const z = (hash1(seed * 2.3) - 0.5) * 380;
      // Fleurs en taches : seuil de bruit assez haut
      if (noise2(x * 0.045 + 3.1, z * 0.045 + 17.7) < 0.58) continue;
      const m = grid.masks(x, z);
      if (m.underwater > 0 || m.slope > 0.3 || m.beach > 0.35) continue;
      if (m.lakeDist < LAKE.radius + 2) continue;
      if (Math.hypot(x, z) < 3) continue;

      positions.push(x, m.height, z);
      scales.push(0.16 + hash1(seed * 4.1) * 0.14);
      rots.push(hash1(seed * 5.9) * Math.PI * 2);
      tints.push(hash1(seed * 6.7));
      phases.push(hash1(seed * 7.3) * Math.PI * 2);
      const col = FLOWER_PALETTE[Math.floor(hash1(seed * 8.9) * FLOWER_PALETTE.length)];
      colors.push(col.r, col.g, col.b);
      placed++;
    }

    geometry.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('iScale', new THREE.InstancedBufferAttribute(new Float32Array(scales), 1));
    geometry.setAttribute('iRot', new THREE.InstancedBufferAttribute(new Float32Array(rots), 1));
    geometry.setAttribute('iTint', new THREE.InstancedBufferAttribute(new Float32Array(tints), 1));
    geometry.setAttribute('iPhase', new THREE.InstancedBufferAttribute(new Float32Array(phases), 1));
    geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));

    const material = new THREE.ShaderMaterial({
      vertexShader: FLOWER_VERT,
      fragmentShader: FLOWER_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uStemCol: { value: new THREE.Color(0x3c7a30) },
        },
      ]),
      fog: true,
      side: THREE.DoubleSide,
    });
    this.makeSharedUniforms(material.uniforms);

    const instanced = new THREE.InstancedMesh(geometry, material, placed);
    instanced.frustumCulled = false;
    instanced.castShadow = false;
    instanced.receiveShadow = false;
    this.group.add(instanced);
  }

  update(elapsed: number, playerPos: THREE.Vector3, camPos: THREE.Vector3): void {
    this.time.value = elapsed;
    this.playerPos.value.copy(playerPos);
    this.camPos.value.copy(camPos);
  }
}
