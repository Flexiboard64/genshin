import * as THREE from 'three';

/**
 * Ciel procédural (aucune texture → aucune couture) :
 * dégradé atmosphérique, disque solaire aligné sur la DirectionalLight,
 * nuages fbm animés en projection planaire, fondu brouillard à l'horizon.
 * L'IBL (scene.environment) est générée par PMREM depuis le même matériau.
 */

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunWarm;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uTime;
varying vec3 vDir;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * vnoise(p);
    p = p * 2.04 + vec2(17.3, 9.1);
    amp *= 0.52;
  }
  return sum;
}

void main() {
  vec3 dir = normalize(vDir);
  float elev = clamp(dir.y, 0.0, 1.0);
  float sunPos = max(dot(dir, uSunDir), 0.0);

  // Dégradé atmosphérique
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.24, elev));
  col = mix(col, uZenith, smoothstep(0.18, 0.8, elev));

  // Diffusion chaude côté soleil + halo + disque HDR (bloom)
  col += uSunWarm * pow(sunPos, 6.0) * 0.14 * (1.0 - elev);
  col += uSunWarm * pow(sunPos, 42.0) * 0.5;   // large halo atmosphérique
  col += uSunWarm * pow(sunPos, 350.0) * 1.1;  // couronne brillante
  float disc = smoothstep(0.99985, 0.99995, sunPos);
  col += vec3(14.0, 12.0, 10.0) * disc;        // HDR → bloom

  // Sous l'horizon : fondu vers le ton du sol (invisible en jeu, nourrit l'IBL)
  col = mix(uGround, col, smoothstep(-0.14, 0.01, dir.y));

  // Nuages — projection planaire : coordonnées continues sur 360°, zéro couture
  float horizonFade = smoothstep(0.015, 0.26, dir.y);
  if (horizonFade > 0.001) {
    vec2 cp = dir.xz / (dir.y + 0.18);
    vec2 drift = vec2(uTime * 0.006, uTime * 0.0025);
    // Grande structure + détail : cumulus lisibles
    float base = fbm(cp * 0.5 + drift + vec2(4.7, 1.3));
    float detail = fbm(cp * 1.7 + drift * 1.3 + vec2(9.2, 5.8));
    float d1 = base * 0.72 + detail * 0.28;
    float cov = smoothstep(0.46, 0.68, d1) * horizonFade;
    if (cov > 0.002) {
      // Ombrage bon marché : second échantillon décalé vers le soleil
      vec2 sunStep = normalize(uSunDir.xz + vec2(1e-4, 0.0)) * 0.07;
      float d2 = fbm((cp + sunStep) * 0.5 + drift + vec2(4.7, 1.3)) * 0.72
               + fbm((cp + sunStep) * 1.7 + drift * 1.3 + vec2(9.2, 5.8)) * 0.28;
      float lit = clamp(0.5 + (d2 - d1) * 3.2, 0.0, 1.0);
      vec3 cloudCol = mix(uCloudShade, uCloudLit, lit);
      cloudCol += uSunWarm * pow(sunPos, 3.0) * 0.28;
      col = mix(col, cloudCol, cov * 0.96);
    }
    // Cirrus hauts et fins
    float cir = fbm(cp * 2.6 + drift * 1.6 + vec2(13.1, 8.9));
    cir = smoothstep(0.58, 0.88, cir) * 0.24 * horizonFade;
    col = mix(col, uCloudLit * 0.98, cir);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  private readonly material: THREE.ShaderMaterial;
  private readonly dome: THREE.Mesh;
  private time = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sunDirection: THREE.Vector3) {
    // Brouillard resserré : le bord du monde (400 m) fond dans la brume ;
    // l'horizon du dôme utilise exactement cette couleur → fusion invisible.
    const fogColor = new THREE.Color(0xcfe0f0);
    scene.fog = new THREE.Fog(fogColor, 70, 300);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: sunDirection },
        uZenith: { value: new THREE.Color(0x2e63c8) },
        uMid: { value: new THREE.Color(0x77aae8) },
        uHorizon: { value: fogColor },
        uGround: { value: new THREE.Color(0x8fa66b) },
        uSunWarm: { value: new THREE.Color(0xffd9a0) },
        uCloudLit: { value: new THREE.Color(0xffffff) },
        uCloudShade: { value: new THREE.Color(0xa9b6cf) },
        uTime: { value: 0 },
      },
    });

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(950, 48, 24), this.material);
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    // IBL : capture PMREM d'une petite sphère partageant le même matériau
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.material));
    scene.environment = pmrem.fromScene(envScene, 0.035, 1, 150).texture;
    scene.environmentIntensity = 0.35;
    pmrem.dispose();
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    // Le dôme suit la caméra : l'horizon reste à distance infinie partout
    this.dome.position.copy(cameraPos);
  }
}
