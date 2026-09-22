import * as THREE from 'three';
import { PYRO, GOLD } from './Particles';

/**
 * Traînée d'épée : ruban de N segments échantillonné entre la garde et la pointe
 * de la lame pendant les swings. Fade 0,22 s côté shader, blending additif,
 * texture flamme (Magnific) avec repli procédural.
 */

const SEGMENTS = 30;
const TRAIL_LIFE = 0.24;

const VERT = /* glsl */ `
attribute float aBirth;
uniform float uTime;
varying vec2 vUv;
varying float vAge;
void main() {
  vUv = uv;
  vAge = (uTime - aBirth) / ${TRAIL_LIFE.toFixed(2)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tMap;
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec2 vUv;
varying float vAge;
void main() {
  if (vAge < 0.0 || vAge > 1.0) discard;
  vec4 tex = texture2D(tMap, vec2(vUv.x, 1.0 - vUv.y));
  float fade = (1.0 - vAge) * (1.0 - vAge);
  // Cœur blanc vers la pointe (v=1), teinte pyro vers la garde
  vec3 tint = mix(uColorB, vec3(1.0, 0.96, 0.85), smoothstep(0.35, 1.0, vUv.y));
  vec3 col = tex.rgb * tint + uColorA * 0.35 * tex.a;
  float a = max(tex.r, max(tex.g, tex.b)) * fade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

function fallbackTrailTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, 'rgba(255,80,20,0)');
  grad.addColorStop(0.45, 'rgba(255,120,40,0.55)');
  grad.addColorStop(0.8, 'rgba(255,210,130,0.95)');
  grad.addColorStop(1, 'rgba(255,255,240,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);
  const tail = ctx.createLinearGradient(0, 0, 128, 0);
  tail.addColorStop(0, 'rgba(0,0,0,1)');
  tail.addColorStop(0.25, 'rgba(0,0,0,0)');
  tail.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = tail;
  ctx.fillRect(0, 0, 128, 64);
  return new THREE.CanvasTexture(canvas);
}

export class SwordTrail {
  private readonly time = { value: 0 };
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: THREE.BufferAttribute;
  private readonly births: THREE.BufferAttribute;
  private cursor = 0;
  private swinging = false;
  private hasPrev = false;
  private readonly prevBase = new THREE.Vector3();
  private readonly prevTip = new THREE.Vector3();

  constructor(scene: THREE.Scene, texture: THREE.Texture | null = null) {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(SEGMENTS * 2 * 3), 3);
    this.births = new THREE.BufferAttribute(new Float32Array(SEGMENTS * 2).fill(-1e4), 1);
    const uvs = new Float32Array(SEGMENTS * 2 * 2);
    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const u = i / (SEGMENTS - 1);
      uvs[i * 4] = u;
      uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = u;
      uvs[i * 4 + 3] = 1;
      if (i < SEGMENTS - 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('aBirth', this.births);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: this.time,
        tMap: { value: texture ?? fallbackTrailTexture() },
        uColorA: { value: PYRO },
        uColorB: { value: GOLD },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    scene.add(mesh);
  }

  /** Début d'un swing : réinitialise la continuité du ruban. */
  begin(): void {
    this.swinging = true;
    this.hasPrev = false;
  }

  end(): void {
    this.swinging = false;
  }

  /** Échantillonne la position garde→pointe (coordonnées monde) pour cette frame. */
  sample(base: THREE.Vector3, tip: THREE.Vector3): void {
    if (!this.swinging) return;
    const now = this.time.value;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % SEGMENTS;
    this.positions.setXYZ(i * 2, base.x, base.y, base.z);
    this.positions.setXYZ(i * 2 + 1, tip.x, tip.y, tip.z);
    this.births.setX(i * 2, now);
    this.births.setX(i * 2 + 1, now);

    if (!this.hasPrev) {
      // Évite la strie géante entre la fin du swing précédent et celui-ci :
      // on duplique le premier échantillon dans le slot précédent.
      const prev = (i - 1 + SEGMENTS) % SEGMENTS;
      this.positions.setXYZ(prev * 2, base.x, base.y, base.z);
      this.positions.setXYZ(prev * 2 + 1, tip.x, tip.y, tip.z);
      this.births.setX(prev * 2, now - TRAIL_LIFE);
      this.births.setX(prev * 2 + 1, now - TRAIL_LIFE);
      this.hasPrev = true;
    }
    this.prevBase.copy(base);
    this.prevTip.copy(tip);
    this.positions.needsUpdate = true;
    this.births.needsUpdate = true;
  }

  update(elapsed: number): void {
    this.time.value = elapsed;
  }
}
