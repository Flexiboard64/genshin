import * as THREE from 'three';

/**
 * Ciel polaire de Snezhnaya — crépuscule permanent + aurore boréale.
 * Même architecture que Sky.ts (dôme shader 100 % procédural, zéro couture,
 * PMREM pour l'IBL), palette indigo/ambre froid, soleil très bas (~16°),
 * 3 rideaux d'aurore fbm animés (vert/cyan/violet) et champ d'étoiles.
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
uniform float uAuroraBoost;
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

// Rideau d'aurore : bande fine ondulante + striations verticales scintillantes
float curtain(vec2 cp, float offset, float freq, float t) {
  float wave = fbm(vec2(cp.x * 0.55 + offset * 7.1, t * 0.05)) * 2.2 - 1.1;
  float d = cp.y - wave - offset;
  float band = exp(-d * d * 7.0);
  float rays = fbm(vec2(cp.x * freq + offset * 13.7, cp.y * 0.35 - t * 0.10));
  float stripes = pow(0.35 + 0.65 * rays, 2.0);
  float flicker = 0.7 + 0.3 * sin(t * 0.6 + offset * 9.4 + cp.x * 1.7);
  return band * stripes * flicker;
}

void main() {
  vec3 dir = normalize(vDir);
  float elev = clamp(dir.y, 0.0, 1.0);
  float sunPos = max(dot(dir, uSunDir), 0.0);

  // Dégradé crépusculaire : ambre froid à l'horizon → indigo profond au zénith
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.20, elev));
  col = mix(col, uZenith, smoothstep(0.16, 0.72, elev));

  // Soleil très bas : lueur dorée rasante + disque HDR
  col += uSunWarm * pow(sunPos, 5.0) * 0.30 * (1.0 - elev);
  col += uSunWarm * pow(sunPos, 40.0) * 0.55;
  col += uSunWarm * pow(sunPos, 320.0) * 1.2;
  float disc = smoothstep(0.99985, 0.99995, sunPos);
  col += vec3(13.0, 10.0, 7.5) * disc;

  // Sous l'horizon : neige pâle (nourrit l'IBL froid)
  col = mix(uGround, col, smoothstep(-0.14, 0.01, dir.y));

  // Étoiles faibles dans la moitié haute (le crépuscule polaire les laisse voir)
  if (dir.y > 0.12) {
    vec3 sp = dir * 220.0;
    vec2 cell = floor(sp.xz / (0.35 + dir.y * 0.6)) + floor(sp.y) * 31.7;
    float sh = hash21(cell);
    float star = step(0.992, sh);
    float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + sh * 3.0) + sh * 80.0);
    col += vec3(0.9, 0.95, 1.0) * star * twinkle * smoothstep(0.12, 0.5, dir.y) * 0.5;
  }

  // Aurore boréale : 3 rideaux (vert, cyan, violet) hauts dans le ciel
  float auroraZone = smoothstep(0.22, 0.5, dir.y);
  if (auroraZone > 0.001) {
    vec2 cp = dir.xz / (dir.y + 0.42);
    cp *= 1.15;
    float t = uTime;
    float c1 = curtain(cp, 0.15, 14.0, t);
    float c2 = curtain(cp * 1.25 + vec2(3.7, 1.2), -0.35, 18.0, t * 1.15);
    float c3 = curtain(cp * 0.8 + vec2(-5.1, 2.6), 0.55, 11.0, t * 0.85);
    vec3 aurora = vec3(0.15, 1.0, 0.55) * c1 * 0.55
                + vec3(0.2, 0.75, 1.0) * c2 * 0.7
                + vec3(0.65, 0.35, 1.0) * c3 * 0.55;
    // Bord supérieur violacé du rideau principal
    aurora += vec3(0.5, 0.2, 0.9) * c1 * c1 * 0.30;
    col += aurora * auroraZone * 0.5 * uAuroraBoost;
  }

  // Nuages bas et lents, teintés crépuscule
  float horizonFade = smoothstep(0.015, 0.24, dir.y);
  if (horizonFade > 0.001) {
    vec2 cp = dir.xz / (dir.y + 0.20);
    vec2 drift = vec2(uTime * 0.004, uTime * 0.0016);
    float base = fbm(cp * 0.45 + drift + vec2(6.7, 2.3));
    float detail = fbm(cp * 1.5 + drift * 1.3 + vec2(3.2, 7.8));
    float d1 = base * 0.74 + detail * 0.26;
    float cov = smoothstep(0.52, 0.74, d1) * horizonFade;
    if (cov > 0.002) {
      vec2 sunStep = normalize(uSunDir.xz + vec2(1e-4, 0.0)) * 0.07;
      float d2 = fbm((cp + sunStep) * 0.45 + drift + vec2(6.7, 2.3)) * 0.74
               + fbm((cp + sunStep) * 1.5 + drift * 1.3 + vec2(3.2, 7.8)) * 0.26;
      float lit = clamp(0.5 + (d2 - d1) * 3.4, 0.0, 1.0);
      vec3 cloudCol = mix(uCloudShade, uCloudLit, lit);
      cloudCol += uSunWarm * pow(sunPos, 3.0) * 0.35;
      col = mix(col, cloudCol, cov * 0.85);
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export class PolarSky {
  private readonly material: THREE.ShaderMaterial;
  private readonly dome: THREE.Mesh;
  private time = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, sunDirection: THREE.Vector3) {
    // Brouillard froid resserré : la brume bleutée avale l'horizon à 260 m
    const fogColor = new THREE.Color(0x9fb0d4);
    scene.fog = new THREE.Fog(fogColor, 80, 390);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: sunDirection },
        uZenith: { value: new THREE.Color(0x10173a) },
        uMid: { value: new THREE.Color(0x35477f) },
        uHorizon: { value: fogColor },
        uGround: { value: new THREE.Color(0xc9d4e8) },
        uSunWarm: { value: new THREE.Color(0xffb877) },
        uCloudLit: { value: new THREE.Color(0xd8d2e8) },
        uCloudShade: { value: new THREE.Color(0x5c668f) },
        uTime: { value: 0 },
        uAuroraBoost: { value: 1 },
      },
    });

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(950, 48, 24), this.material);
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    // IBL froid : capture PMREM du même matériau
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.material));
    scene.environment = pmrem.fromScene(envScene, 0.035, 1, 150).texture;
    scene.environmentIntensity = 0.42;
    pmrem.dispose();
  }

  /** Finale de quête : aurore ×1,8 pendant `duration` s puis retour progressif. */
  private boostTimer = 0;

  boostAurora(duration = 60): void {
    this.boostTimer = duration;
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.time += dt;
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      const target = this.boostTimer > 0 ? 1.8 : 1;
      const u = this.material.uniforms.uAuroraBoost;
      u.value += (target - u.value) * Math.min(1, 1.6 * dt);
    }
    this.material.uniforms.uTime.value = this.time;
    this.dome.position.copy(cameraPos);
  }
}
