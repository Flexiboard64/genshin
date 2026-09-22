import * as THREE from 'three';

/**
 * Éclaboussures et bulles : un seul THREE.Points (zéro draw call de plus par splash),
 * particules animées côté GPU (âge en shader), spawns côté CPU dans des slots réutilisés.
 * kind 0 = gouttelette (gravité), kind 1 = bulle (flottabilité + oscillation).
 */

const SPLASH_SLOTS = 8;
const SPLASH_PARTICLES = 96;
const BUBBLE_SLOTS = 72;
const TOTAL = SPLASH_SLOTS * SPLASH_PARTICLES + BUBBLE_SLOTS;
const RING_POOL = 4;
const DISC_POOL = 2;

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute float aKind;
uniform float uTime;
uniform float uScale;
varying float vAlpha;
varying float vKind;
void main() {
  float age = uTime - aBirth;
  float t = age / max(aLife, 1e-3);
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vKind = 0.0;
    return;
  }
  // position = origine de la particule (attribut natif)
  vec3 acc = mix(vec3(0.0, -6.5, 0.0), vec3(0.0, 2.1, 0.0), aKind);
  vec3 pos = position + aVel * age + 0.5 * acc * age * age;
  pos.x += sin(age * 6.0 + position.z * 17.0) * 0.06 * aKind;
  pos.z += cos(age * 5.0 + position.x * 19.0) * 0.06 * aKind;
  float scale = aSize * mix(1.0 - 0.4 * t, 0.6 + 1.1 * t, aKind);
  vAlpha = mix(
    1.0 - t * t,
    smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.55, 1.0, t)),
    aKind
  );
  vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = scale * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tMap;
varying float vAlpha;
varying float vKind;
void main() {
  vec4 tex = texture2D(tMap, gl_PointCoord);
  vec3 col = mix(vec3(0.94, 0.98, 1.0), vec3(0.82, 0.95, 1.0), vKind);
  float a = tex.a * vAlpha * 0.9;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

interface RingState {
  life: number;
  total: number;
  grow: number;
}

export class Splash {
  private readonly time = { value: 0 };
  private readonly pointScale = { value: 1 };
  private readonly rings: { mesh: THREE.Mesh; state: RingState }[] = [];
  private readonly discs: { mesh: THREE.Mesh; state: RingState }[] = [];
  private splashSlot = 0;
  private bubbleSlot = 0;
  private ringIdx = 0;
  private discIdx = 0;

  constructor(scene: THREE.Scene) {
    // Sprite radial doux généré (pas d'asset externe)
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);

    const geometry = new THREE.BufferGeometry();
    const dead = -1e4;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TOTAL * 3), 3));
    geometry.setAttribute('aVel', new THREE.BufferAttribute(new Float32Array(TOTAL * 3), 3));
    geometry.setAttribute(
      'aBirth',
      new THREE.BufferAttribute(new Float32Array(TOTAL).fill(dead), 1),
    );
    geometry.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(TOTAL).fill(1), 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(TOTAL), 1));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(TOTAL), 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: this.time,
        uScale: this.pointScale,
        tMap: { value: texture },
      },
      transparent: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 3; // après l'eau (2)
    scene.add(points);
    this.geometry = geometry;

    const ringGeo = new THREE.RingGeometry(0.4, 0.56, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RING_POOL; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xf2fbff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.rings.push({ mesh, state: { life: 0, total: 1, grow: 2 } });
    }

    // Disques de mousse pleins : flash blanc d'impact à la plongée
    const discGeo = new THREE.CircleGeometry(0.55, 28);
    discGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < DISC_POOL; i++) {
      const mesh = new THREE.Mesh(
        discGeo,
        new THREE.MeshBasicMaterial({
          color: 0xf6fcff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.discs.push({ mesh, state: { life: 0, total: 0.5, grow: 2 } });
    }
  }

  private readonly geometry: THREE.BufferGeometry;

  /** Gerbe de gouttelettes + anneau de mousse à l'entrée dans l'eau. */
  burst(x: number, y: number, z: number, strength = 1): void {
    const base = this.splashSlot * SPLASH_PARTICLES;
    this.splashSlot = (this.splashSlot + 1) % SPLASH_SLOTS;
    const now = this.time.value;
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vel = this.geometry.getAttribute('aVel') as THREE.BufferAttribute;
    const birth = this.geometry.getAttribute('aBirth') as THREE.BufferAttribute;
    const life = this.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const size = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const kind = this.geometry.getAttribute('aKind') as THREE.BufferAttribute;

    for (let i = 0; i < SPLASH_PARTICLES; i++) {
      const idx = base + i;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 0.65) * 0.38 * strength;
      // Panache haut et dense au centre + retombées larges
      const core = i % 3 === 0;
      const up = core
        ? (3.2 + Math.random() * 3.2) * (0.55 + strength * 0.6)
        : (1.6 + Math.random() * 2.4) * (0.55 + strength * 0.55);
      const lateral = core
        ? Math.random() * 0.7
        : (0.6 + Math.random() * 2.1) * strength * 0.85;
      pos.setXYZ(
        idx,
        x + Math.cos(angle) * radius,
        y + 0.05,
        z + Math.sin(angle) * radius,
      );
      vel.setXYZ(idx, Math.cos(angle) * lateral, up, Math.sin(angle) * lateral);
      birth.setX(idx, now + (core ? 0 : Math.random() * 0.08));
      life.setX(idx, 0.5 + Math.random() * 0.65);
      size.setX(idx, (0.06 + Math.random() * 0.13) * (0.65 + strength * 0.55));
      kind.setX(idx, 0);
    }
    for (const attr of [pos, vel, birth, life, size, kind]) attr.needsUpdate = true;

    const ring = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % RING_POOL;
    ring.mesh.position.set(x, y + 0.04, z);
    ring.mesh.scale.setScalar(0.6);
    ring.mesh.visible = true;
    ring.state.total = 0.85 + strength * 0.3;
    ring.state.life = ring.state.total;
    ring.state.grow = 2.4 + strength * 1.6;

    const disc = this.discs[this.discIdx];
    this.discIdx = (this.discIdx + 1) % DISC_POOL;
    disc.mesh.position.set(x, y + 0.03, z);
    disc.mesh.scale.setScalar(0.5);
    disc.mesh.visible = true;
    disc.state.total = 0.5;
    disc.state.life = 0.5;
    disc.state.grow = 1.5 + strength * 0.9;
  }

  /** Bulle qui monte depuis le corps immergé. */
  bubble(x: number, y: number, z: number): void {
    const idx = SPLASH_SLOTS * SPLASH_PARTICLES + this.bubbleSlot;
    this.bubbleSlot = (this.bubbleSlot + 1) % BUBBLE_SLOTS;
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vel = this.geometry.getAttribute('aVel') as THREE.BufferAttribute;
    const birth = this.geometry.getAttribute('aBirth') as THREE.BufferAttribute;
    const life = this.geometry.getAttribute('aLife') as THREE.BufferAttribute;
    const size = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const kind = this.geometry.getAttribute('aKind') as THREE.BufferAttribute;
    pos.setXYZ(idx, x + (Math.random() - 0.5) * 0.2, y, z + (Math.random() - 0.5) * 0.2);
    vel.setXYZ(idx, 0, 0.25 + Math.random() * 0.2, 0);
    birth.setX(idx, this.time.value);
    life.setX(idx, 0.8 + Math.random() * 0.5);
    size.setX(idx, 0.03 + Math.random() * 0.035);
    kind.setX(idx, 1);
    for (const attr of [pos, vel, birth, life, size, kind]) attr.needsUpdate = true;
  }

  update(dt: number, elapsed: number, camera: THREE.PerspectiveCamera, canvasHeight: number): void {
    this.time.value = elapsed;
    this.pointScale.value =
      (canvasHeight / 2) * camera.projectionMatrix.elements[5];

    for (const { mesh, state } of this.rings) {
      if (!mesh.visible) continue;
      state.life -= dt;
      const t = 1 - Math.max(state.life, 0) / state.total;
      mesh.scale.setScalar(0.6 + t * state.grow);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
      if (state.life <= 0) mesh.visible = false;
    }
    for (const { mesh, state } of this.discs) {
      if (!mesh.visible) continue;
      state.life -= dt;
      const t = 1 - Math.max(state.life, 0) / state.total;
      mesh.scale.setScalar(0.5 + t * state.grow);
      // Flash d'impact : opacité forte qui retombe vite
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t) * (1 - t);
      if (state.life <= 0) mesh.visible = false;
    }
  }
}
