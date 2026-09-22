import * as THREE from 'three';
import { ICE_LEVEL, FROZEN_LAKE, GORGE, gorgeCenterX } from './SnowTerrain';

/**
 * Glace praticable de Snezhnaya : disque du lac gelé + rivière au fond de
 * la gorge. Shader opaque : teinte profonde, craquelures, reflet soleil
 * rasant, étincelles — aucune transparence (on marche dessus).
 */

const VERT = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNormal;
void main() {
  vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
  vWNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tIce;
uniform vec3 uSunDir;
uniform float uTime;
uniform vec3 uCamPos;
uniform float uFadeRadius; // rayon de fondu de bord (0 = aucun)
uniform vec2 uCenter;
varying vec3 vWPos;
varying vec3 vWNormal;

float il_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float il_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(il_hash(i), il_hash(i + vec2(1.0, 0.0)), u.x),
    mix(il_hash(i + vec2(0.0, 1.0)), il_hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}
float il_fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * il_noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 viewDir = normalize(uCamPos - vWPos);

  // Couche glace : texture plus présente + teinte de profondeur
  vec3 iceTex = texture2D(tIce, vWPos.xz * 0.08).rgb;
  float depthN = il_fbm(vWPos.xz * 0.035 + 4.7);
  vec3 deep = vec3(0.05, 0.16, 0.30);
  vec3 shallow = vec3(0.45, 0.65, 0.80);
  vec3 col = mix(shallow, deep, depthN * 0.85 + 0.15) * (iceTex * 1.1 + 0.3);
  // Auto-lumière cyan douce : la glace reste lisible dans l'ombre de la gorge
  col += vec3(0.06, 0.15, 0.24) * 0.35;

  // Neige plaquée par le vent : grandes taches blanches (amplifiées aux bords)
  float edgeD = uFadeRadius > 0.0 ? distance(vWPos.xz, uCenter) / uFadeRadius : 0.0;
  float snowP = il_fbm(vWPos.xz * 0.055 + 13.1);
  float snowCover = smoothstep(0.50, 0.70, snowP)
                  + smoothstep(0.72, 0.92, edgeD) * 0.55;
  snowCover = clamp(snowCover, 0.0, 1.0);
  vec3 snowCol = vec3(0.88, 0.92, 0.98) * (0.85 + 0.3 * il_noise(vWPos.xz * 0.8));
  col = mix(col, snowCol, snowCover * 0.88);
  float open = 1.0 - snowCover; // glace à nu

  // Craquelures : fines blanches + larges veines bleutées
  float c1 = 1.0 - abs(2.0 * il_noise(vWPos.xz * 0.6) - 1.0);
  float c2 = 1.0 - abs(2.0 * il_noise(vWPos.xz * 0.23 + 9.1) - 1.0);
  float fine = smoothstep(0.955, 0.99, c1);
  float large = smoothstep(0.93, 0.985, c2);
  col += vec3(0.85, 0.92, 1.0) * fine * 0.6 * open;
  col += vec3(0.55, 0.75, 0.95) * large * 0.38 * (1.0 - snowCover * 0.5);

  // Reflet du ciel : miroir à incidence rasante (glace polie à nu)
  float fres = pow(1.0 - max(dot(viewDir, vWNormal), 0.0), 3.0);
  col = mix(col, vec3(0.60, 0.71, 0.90), fres * 0.75 * (1.0 - snowCover * 0.7));

  // Reflet du soleil rasant : traînée brillante
  vec3 n = normalize(vWNormal + vec3(
    il_noise(vWPos.xz * 0.9) * 0.06 - 0.03,
    0.0,
    il_noise(vWPos.xz * 0.9 + 3.3) * 0.06 - 0.03));
  vec3 refl = reflect(-viewDir, n);
  float spec = pow(max(dot(refl, uSunDir), 0.0), 180.0);
  col += vec3(1.0, 0.85, 0.6) * spec * 2.0 * open;

  // Étincelles scintillantes
  vec2 cell = floor(vWPos.xz * 30.0);
  float gh = il_hash(cell);
  float tw = sin(uTime * 2.6 + gh * 50.0) * 0.5 + 0.5;
  float glint = step(0.985, gh) * smoothstep(0.7, 1.0, tw);
  col += vec3(0.8, 0.9, 1.0) * glint * 0.8;

  float alpha = 1.0;
  if (uFadeRadius > 0.0) {
    alpha = 1.0 - smoothstep(uFadeRadius - 3.0, uFadeRadius, distance(vWPos.xz, uCenter));
  }
  gl_FragColor = vec4(col, alpha);
}
`;

export class IceLake {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private time = 0;

  constructor(iceTexture: THREE.Texture | null, sunDirection: THREE.Vector3) {
    this.group.name = 'ice-lake';
    const tex = iceTexture ?? this.fallbackIce();

    // Disque du lac gelé
    const lakeMat = this.makeMaterial(tex, sunDirection, FROZEN_LAKE.radius + 2, FROZEN_LAKE.x, FROZEN_LAKE.z);
    const lake = new THREE.Mesh(new THREE.CircleGeometry(FROZEN_LAKE.radius + 4, 48), lakeMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(FROZEN_LAKE.x, ICE_LEVEL, FROZEN_LAKE.z);
    lake.receiveShadow = true;
    this.group.add(lake);

    // Rivière gelée au fond de la gorge (ruban segmenté suivant la sinuosité)
    const riverMat = this.makeMaterial(tex, sunDirection, 0, 0, 0);
    const riverGeo = new THREE.PlaneGeometry(1, 1, 24, 120);
    riverGeo.rotateX(-Math.PI / 2);
    const pos = riverGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) * 400;
      const u = pos.getX(i); // -0.5..0.5
      const cx = gorgeCenterX(z);
      pos.setX(i, cx + u * (GORGE.halfWidth * 2 + 6));
      pos.setZ(i, z);
      pos.setY(i, GORGE.floor + 0.35);
    }
    riverGeo.computeVertexNormals();
    const river = new THREE.Mesh(riverGeo, riverMat);
    river.receiveShadow = true;
    this.group.add(river);
  }

  private makeMaterial(
    tex: THREE.Texture,
    sunDirection: THREE.Vector3,
    fadeRadius: number,
    cx: number,
    cz: number,
  ): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: fadeRadius > 0,
      uniforms: {
        tIce: { value: tex },
        uSunDir: { value: sunDirection },
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uFadeRadius: { value: fadeRadius },
        uCenter: { value: new THREE.Vector2(cx, cz) },
      },
    });
    this.materials.push(material);
    return material;
  }

  private fallbackIce(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#bcd4e8';
    ctx.fillRect(0, 0, 4, 4);
    return new THREE.CanvasTexture(canvas);
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.time += dt;
    for (const m of this.materials) {
      m.uniforms.uTime.value = this.time;
      (m.uniforms.uCamPos.value as THREE.Vector3).copy(cameraPos);
    }
  }
}
