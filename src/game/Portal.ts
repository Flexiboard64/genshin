import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { normalizeMeshyMaterials } from '../core/materials';
import { CRYO } from '../fx/Particles';
import type { Input } from '../core/Input';
import type { Hud } from '../ui/Hud';

export interface PortalDeps {
  model: GLTF | null;
  swirl: THREE.Texture | null;
  x: number;
  z: number;
  groundAt: (x: number, z: number) => number;
  /** Texte du prompt, ex. « Voyager vers Snezhnaya ». */
  label: string;
  /** Query cible, ex. '?world=snezhnaya'. */
  target: string;
  /** Appelé au déclenchement du voyage (SFX téléportation). */
  onActivate?: () => void;
}

const GATE_HEIGHT = 3.6;
const INTERACT_RANGE = 3.4;
const MOTES = 42;

const SWIRL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Disque de téléportation : double tourbillon contra-rotatif + cœur pulsant. */
const SWIRL_FRAG = /* glsl */ `
uniform sampler2D tSwirl;
uniform float uTime;
uniform float uBoost;
varying vec2 vUv;

void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  // Deux couches spiralées en rotation opposée
  vec2 uv1 = vec2(a / 6.2831 + uTime * 0.11, r - uTime * 0.16);
  vec2 uv2 = vec2(a / 6.2831 - uTime * 0.07, r * 1.4 + uTime * 0.09);
  float s1 = texture2D(tSwirl, uv1 * vec2(1.0, 2.0)).r;
  float s2 = texture2D(tSwirl, uv2 * vec2(1.0, 2.0)).g;
  float swirl = s1 * 0.75 + s2 * 0.55;
  // Anneau d'énergie + cœur lumineux + extinction au bord
  float ring = smoothstep(0.06, 0.0, abs(r - 0.86 - sin(uTime * 2.2) * 0.03)) * 1.6;
  float core = smoothstep(0.55, 0.0, r);
  float edge = smoothstep(1.0, 0.72, r);
  float pulse = 0.82 + 0.18 * sin(uTime * 3.1);
  // Membrane d'énergie permanente : le portail rayonne, même sans texture
  float membrane = edge * (0.5 + 0.12 * sin(uTime * 1.7)) * pulse;
  vec3 col = vec3(0.35, 0.85, 1.0) * (swirl * core * 1.6 + ring + membrane) * pulse;
  col += vec3(0.8, 0.97, 1.0) * core * 0.9 * pulse;
  float alpha = (swirl * core * 0.9 + ring * 0.8 + core * 0.5 + membrane * 0.7) * edge * uBoost;
  gl_FragColor = vec4(col * uBoost * 2.0, alpha);
}
`;

/** Anneau au sol : cercle runique doux marquant la zone d'interaction. */
const RING_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float dash = 0.75 + 0.25 * sin(a * 24.0 + uTime * 1.4);
  float ring = smoothstep(0.045, 0.0, abs(r - 0.9)) * dash;
  float inner = smoothstep(0.02, 0.0, abs(r - 0.62)) * 0.5;
  float glow = smoothstep(1.0, 0.35, r) * 0.10;
  float pulse = 0.8 + 0.2 * sin(uTime * 2.0);
  vec3 col = vec3(0.35, 0.85, 1.0) * (ring + inner + glow) * pulse;
  gl_FragColor = vec4(col * 1.5, (ring * 0.85 + inner * 0.5 + glow) * pulse);
}
`;

/**
 * Portail de voyage entre mondes : arche Meshy (ou anneau procédural de
 * secours), disque tourbillonnant, anneau au sol, particules orbitales.
 * À portée, le prompt « F » du HUD déclenche fondu → rechargement du monde
 * cible (écran de chargement, comme les téléportations de Genshin).
 */
export class Portal {
  private readonly group = new THREE.Group();
  private readonly swirlMat: THREE.ShaderMaterial;
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly motes: THREE.Points;
  private readonly moteSeeds = new Float32Array(MOTES * 3);
  private readonly light: THREE.PointLight;
  private readonly pos: THREE.Vector3;
  private readonly label: string;
  private readonly target: string;
  private readonly onActivate?: () => void;
  private traveled = false;
  private wasNear = false;
  private boost = 1;

  constructor(scene: THREE.Scene, deps: PortalDeps) {
    this.label = deps.label;
    this.target = deps.target;
    this.onActivate = deps.onActivate;
    const y = deps.groundAt(deps.x, deps.z);
    this.pos = new THREE.Vector3(deps.x, y, deps.z);
    this.group.position.copy(this.pos);

    // ——— Arche : modèle Meshy calibré, sinon anneau procédural ———
    if (deps.model) {
      const gate = deps.model.scene.clone(true);
      normalizeMeshyMaterials(gate, 1.0);
      const box = new THREE.Box3().setFromObject(gate);
      const size = new THREE.Vector3();
      box.getSize(size);
      const s = GATE_HEIGHT / Math.max(size.y, 0.01);
      gate.scale.setScalar(s);
      gate.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s, -((box.min.z + box.max.z) / 2) * s);
      gate.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) child.castShadow = true;
      });
      this.group.add(gate);
    } else {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.7, 0.14, 12, 48),
        new THREE.MeshStandardMaterial({
          color: 0x9fb4c8, metalness: 0.85, roughness: 0.3,
          emissive: new THREE.Color(0.25, 0.7, 1.0), emissiveIntensity: 0.5,
        }),
      );
      ring.position.y = GATE_HEIGHT * 0.62;
      ring.castShadow = true;
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.35, 0.5, 24),
        new THREE.MeshStandardMaterial({ color: 0xb8c4d2, roughness: 0.8 }),
      );
      pedestal.position.y = 0.25;
      pedestal.castShadow = true;
      this.group.add(ring, pedestal);
    }

    // ——— Disque tourbillonnant au centre de l'arche ———
    const swirlTex = deps.swirl ?? Portal.defaultSwirlTexture();
    swirlTex.wrapS = THREE.RepeatWrapping;
    swirlTex.wrapT = THREE.RepeatWrapping;
    this.swirlMat = new THREE.ShaderMaterial({
      vertexShader: SWIRL_VERT,
      fragmentShader: SWIRL_FRAG,
      uniforms: {
        tSwirl: { value: swirlTex },
        uTime: { value: 0 },
        uBoost: { value: 1 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.9), this.swirlMat);
    disc.position.y = GATE_HEIGHT * 0.58;
    disc.renderOrder = 5;
    this.group.add(disc);

    // ——— Anneau runique au sol ———
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: SWIRL_VERT,
      fragmentShader: RING_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ringGround = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), this.ringMat);
    ringGround.rotation.x = -Math.PI / 2;
    ringGround.position.y = 0.06;
    ringGround.renderOrder = 4;
    this.group.add(ringGround);

    // ——— Particules orbitales montantes (GPU-animées par update) ———
    const moteGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      this.moteSeeds[i * 3] = Math.random() * Math.PI * 2; // angle de départ
      this.moteSeeds[i * 3 + 1] = 0.6 + Math.random() * 1.4; // rayon
      this.moteSeeds[i * 3 + 2] = 0.25 + Math.random() * 0.75; // vitesse
      positions[i * 3 + 1] = Math.random() * GATE_HEIGHT;
    }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.motes = new THREE.Points(
      moteGeo,
      new THREE.PointsMaterial({
        color: new THREE.Color(0.55, 0.9, 1.0),
        size: 0.09,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    // ——— Lueur cyan (1 seule lumière, portée courte) ———
    this.light = new THREE.PointLight(CRYO, 22, 14, 1.8);
    this.light.position.y = GATE_HEIGHT * 0.6;
    this.group.add(this.light);

    scene.add(this.group);
  }

  /** Boucle : animation + détection d'interaction. */
  update(dt: number, elapsed: number, playerPos: THREE.Vector3, input: Input, hud: Hud): void {
    this.swirlMat.uniforms.uTime.value = elapsed;
    this.ringMat.uniforms.uTime.value = elapsed;
    this.light.intensity = 20 + Math.sin(elapsed * 2.6) * 5;

    // Particules : spirale ascendante, zéro allocation (buffer réécrit)
    const attr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MOTES; i++) {
      const a0 = this.moteSeeds[i * 3];
      const r = this.moteSeeds[i * 3 + 1];
      const v = this.moteSeeds[i * 3 + 2];
      const t = elapsed * v + a0;
      const h = (elapsed * v * 0.55 + a0) % 1;
      attr.setXYZ(
        i,
        Math.cos(t) * r * (1 - h * 0.4),
        0.3 + h * (GATE_HEIGHT - 0.4),
        Math.sin(t) * r * (1 - h * 0.4),
      );
    }
    attr.needsUpdate = true;

    if (this.traveled) {
      // Aspiration visuelle pendant le fondu
      this.boost = Math.min(this.boost + dt * 2.4, 3.2);
      this.swirlMat.uniforms.uBoost.value = this.boost;
      return;
    }

    const dx = playerPos.x - this.pos.x;
    const dz = playerPos.z - this.pos.z;
    const near = dx * dx + dz * dz < INTERACT_RANGE * INTERACT_RANGE;
    // Ne touche le prompt que si le portail est (ou était) concerné : écrire
    // null chaque frame écraserait le prompt des Interactables (porte, PNJ…).
    if (near) {
      hud.setInteractPrompt(this.label);
      this.wasNear = true;
    } else if (this.wasNear) {
      this.wasNear = false;
      hud.setInteractPrompt(null);
    }
    if (near && input.consumeInteract()) {
      this.traveled = true;
      hud.setInteractPrompt(null);
      this.onActivate?.();
      Portal.fadeAndGo(this.target);
    }
  }

  private static fadeAndGo(target: string): void {
    const fade = document.createElement('div');
    fade.className = 'portal-fade';
    document.body.appendChild(fade);
    requestAnimationFrame(() => fade.classList.add('show'));
    window.setTimeout(() => {
      window.location.href = window.location.pathname + target;
    }, 650);
  }

  /** Texture de secours : spirale procédurale si le PNG Magnific manque. */
  private static defaultSwirlTexture(): THREE.Texture {
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const u = i / size;
        const v = j / size;
        const s = 0.5 + 0.5 * Math.sin((u * 6 + v * 2) * Math.PI * 2);
        const g = 0.5 + 0.5 * Math.sin((u * 3 - v * 5) * Math.PI * 2 + 1.7);
        const idx = (j * size + i) * 4;
        data[idx] = s * 255;
        data[idx + 1] = g * 255;
        data[idx + 2] = (s * 0.6 + g * 0.4) * 255;
        data[idx + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.needsUpdate = true;
    return tex;
  }
}
