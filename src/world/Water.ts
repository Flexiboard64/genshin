import * as THREE from 'three';
import { HeightGrid, TERRAIN_SIZE, WATER_LEVEL } from './Terrain';

const HEIGHT_RES = 512;

const VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWPos;
#include <fog_pars_vertex>
void main() {
  vec3 pos = position;
  float w = sin(pos.x * 0.35 + uTime * 1.15) * 0.05
          + sin(pos.z * 0.28 + uTime * 0.9) * 0.05
          + sin((pos.x + pos.z) * 0.12 + uTime * 0.55) * 0.035;
  pos.y += w;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D tHeight;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform float uWaterLevel;
uniform float uTerrainSize;
varying vec3 vWPos;
#include <fog_pars_fragment>

float w_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float w_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(w_hash(i), w_hash(i + vec2(1.0, 0.0)), u.x),
    mix(w_hash(i + vec2(0.0, 1.0)), w_hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

void main() {
  float terrain = texture2D(tHeight, vWPos.xz / uTerrainSize + 0.5).r;
  float depth = max(uWaterLevel - terrain, 0.0);

  // Normales animées (deux nappes de bruit croisées)
  vec2 p1 = vWPos.xz * 0.55 + vec2(uTime * 0.06, uTime * 0.045);
  vec2 p2 = vWPos.xz * 1.15 - vec2(uTime * 0.05, -uTime * 0.07);
  float n1 = w_noise(p1);
  float n2 = w_noise(p2);
  vec3 N = normalize(vec3(
    (n1 - 0.5) * 0.42 + (n2 - 0.5) * 0.20,
    1.0,
    (n2 - 0.5) * 0.42 + (n1 - 0.5) * 0.18));

  vec3 V = normalize(cameraPosition - vWPos);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.15, 3.4, depth));

  // Scintillement soleil
  float spec = pow(max(dot(reflect(-uSunDir, N), V), 0.0), 120.0) * 1.2;
  col += spec * vec3(1.0, 0.98, 0.9);

  // Mousse de rivage
  float foamBand = 1.0 - smoothstep(0.03, 0.42, depth);
  float foamN = w_noise(vWPos.xz * 1.5 + vec2(uTime * 0.35, -uTime * 0.22)) * 0.6
              + w_noise(vWPos.xz * 3.4 - vec2(uTime * 0.28)) * 0.4;
  float foam = foamBand * smoothstep(0.52, 0.8, foamN + foamBand * 0.35);
  col = mix(col, vec3(0.93, 0.97, 0.96), foam * 0.85);

  // Fresnel vers la couleur du ciel
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col = mix(col, uSky, fres * 0.65 + 0.06);

  // Assez transparent pour laisser lire le nageur immergé
  float alpha = mix(0.46, 0.92, smoothstep(0.0, 1.6, depth));
  alpha = max(alpha, foam * 0.9);

  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;

/** Plan d'eau animé, teinté par la profondeur du terrain sous-jacent. */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(grid: HeightGrid, sunDirection: THREE.Vector3) {
    const heights = new Uint16Array(HEIGHT_RES * HEIGHT_RES);
    const half = TERRAIN_SIZE / 2;
    const step = TERRAIN_SIZE / (HEIGHT_RES - 1);
    for (let j = 0; j < HEIGHT_RES; j++) {
      const z = -half + j * step;
      for (let i = 0; i < HEIGHT_RES; i++) {
        heights[j * HEIGHT_RES + i] = THREE.DataUtils.toHalfFloat(grid.sample(-half + i * step, z));
      }
    }
    const tHeight = new THREE.DataTexture(
      heights,
      HEIGHT_RES,
      HEIGHT_RES,
      THREE.RedFormat,
      THREE.HalfFloatType,
    );
    tHeight.minFilter = THREE.LinearFilter;
    tHeight.magFilter = THREE.LinearFilter;
    tHeight.wrapS = THREE.ClampToEdgeWrapping;
    tHeight.wrapT = THREE.ClampToEdgeWrapping;
    tHeight.needsUpdate = true;

    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        tHeight: { value: null as THREE.Texture | null },
        uShallow: { value: new THREE.Color(0x39cfc0) },
        uDeep: { value: new THREE.Color(0x0d4f7e) },
        uSky: { value: new THREE.Color(0x9ec6ec) },
        uSunDir: { value: sunDirection.clone().normalize() },
        uWaterLevel: { value: WATER_LEVEL },
        uTerrainSize: { value: TERRAIN_SIZE },
      },
    ]);
    // UniformsUtils.merge clone les textures : réassigner la référence partagée.
    this.uniforms.tHeight.value = tHeight;

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
    });

    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 128, 128);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'water';
  }

  update(elapsed: number): void {
    this.uniforms.uTime.value = elapsed;
  }
}
