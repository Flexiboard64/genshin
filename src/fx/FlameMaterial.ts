import * as THREE from 'three';

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

/**
 * Matériau de flamme animée (même recette que Palace.ts) factorisé pour les
 * nouveaux modules (salle du trône, braseros du village). Phase aléatoire
 * par instance pour désynchroniser les feux.
 */
export function makeFlameMaterial(phase: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPhase: { value: phase },
    },
  });
}

/** Flamme conique prête à poser + suivi temporel (setTime à chaque frame). */
export function makeFlame(height: number, phase: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(height * 0.26, height, 8, 6, true);
  geo.translate(0, height * 0.38, 0);
  const flame = new THREE.Mesh(geo, makeFlameMaterial(phase));
  flame.renderOrder = 7;
  return flame;
}
