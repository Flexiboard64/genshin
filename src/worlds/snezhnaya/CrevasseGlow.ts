import * as THREE from 'three';
import { crevasseIntensity, snowHeight } from './SnowTerrain';

/**
 * Lueur cyan des crevasses : quads additifs orientés le long des fissures,
 * étincelles scintillantes et quelques point lights clés (bloom).
 */

const SPARK_VERT = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aPhase;
varying float vTw;
void main() {
  vTw = 0.5 + 0.5 * sin(uTime * (1.6 + aPhase) + aPhase * 40.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.5 + aPhase * 2.0) * uPixelRatio * (160.0 / max(1.0, -mv.z));
}
`;

const SPARK_FRAG = /* glsl */ `
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.15, d) * vTw * 0.85;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(0.55, 0.9, 1.0) * (0.6 + vTw), a);
}
`;

function glowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(160,230,255,0.9)');
  grad.addColorStop(0.4, 'rgba(90,190,240,0.38)');
  grad.addColorStop(1, 'rgba(40,120,200,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class CrevasseGlow {
  readonly group = new THREE.Group();
  private readonly sparkMaterial: THREE.ShaderMaterial;
  private time = 0;

    constructor(pixelRatio: number) {
    this.group.name = 'crevasse-glow';

    // Échantillonnage des fissures : points où la lueur est forte
    const spots: { x: number; z: number; i: number; angle: number }[] = [];
    for (let z = -190; z <= 190; z += 2.4) {
      for (let x = -190; x <= 190; x += 2.4) {
        const ci = crevasseIntensity(x, z);
        if (ci < 0.4) continue;
        // Direction de la fissure : perpendiculaire au gradient
        const gx = crevasseIntensity(x + 1.5, z) - crevasseIntensity(x - 1.5, z);
        const gz = crevasseIntensity(x, z + 1.5) - crevasseIntensity(x, z - 1.5);
        spots.push({ x, z, i: ci, angle: Math.atan2(gx, gz) });
      }
    }
    if (spots.length === 0) {
      this.sparkMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } } });
      return;
    }

    // Quads de lueur au sol (instanciés, additifs)
    const quadCount = Math.min(spots.length, 900);
    const quadGeo = new THREE.PlaneGeometry(1, 1);
    quadGeo.rotateX(-Math.PI / 2);
    const quadMat = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0x66c8f0,
    });
    const quads = new THREE.InstancedMesh(quadGeo, quadMat, quadCount);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (let i = 0; i < quadCount; i++) {
      const s = spots[Math.floor((i / quadCount) * spots.length)];
      pos.set(s.x, snowHeight(s.x, s.z) + 0.35, s.z);
      q.setFromAxisAngle(up, s.angle);
      const size = 2.2 + s.i * 3.2;
      scl.set(size, 1, size * 0.6);
      m4.compose(pos, q, scl);
      quads.setMatrixAt(i, m4);
    }
    quads.instanceMatrix.needsUpdate = true;
    quads.renderOrder = 4;
    quads.frustumCulled = false;
    this.group.add(quads);

    // Étincelles au-dessus des fissures
    const sparkCount = Math.min(spots.length * 2, 1400);
    const positions = new Float32Array(sparkCount * 3);
    const phases = new Float32Array(sparkCount);
    for (let i = 0; i < sparkCount; i++) {
      const s = spots[Math.floor(Math.random() * spots.length)];
      positions[i * 3] = s.x + (Math.random() - 0.5) * 2;
      positions[i * 3 + 1] = snowHeight(s.x, s.z) + 0.3 + Math.random() * 1.2;
      positions[i * 3 + 2] = s.z + (Math.random() - 0.5) * 2;
      phases[i] = Math.random();
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    sparkGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.sparkMaterial = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
      },
    });
    const sparks = new THREE.Points(sparkGeo, this.sparkMaterial);
    sparks.frustumCulled = false;
    sparks.renderOrder = 6;
    this.group.add(sparks);

    // 3 point lights sur les fissures les plus intenses (bloom + ambiance)
    const strongest = [...spots].sort((a, b) => b.i - a.i).slice(0, 60);
    const chosen: { x: number; z: number }[] = [];
    for (const s of strongest) {
      if (chosen.every((c) => Math.hypot(c.x - s.x, c.z - s.z) > 45)) {
        chosen.push(s);
        if (chosen.length >= 3) break;
      }
    }
    for (const c of chosen) {
      const light = new THREE.PointLight(0x5fc4f5, 4.5, 22, 1.9);
      light.position.set(c.x, snowHeight(c.x, c.z) + 1.6, c.z);
      this.group.add(light);
    }
  }

  update(dt: number, pixelRatio: number): void {
    this.time += dt;
    this.sparkMaterial.uniforms.uTime.value = this.time;
    this.sparkMaterial.uniforms.uPixelRatio.value = pixelRatio;
  }
}
