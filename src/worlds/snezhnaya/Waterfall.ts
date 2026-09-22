import * as THREE from 'three';
import { GORGE, gorgeCenterX, snowHeight } from './SnowTerrain';

/**
 * Cascades de glace dévalant les parois de la gorge : rubans shader à
 * défilement (texture écume), brume à la base, lueur cyan.
 */

const FALL_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vEdge;
void main() {
  vUv = uv;
  vEdge = 1.0 - abs(uv.x - 0.5) * 2.0;
  vec3 p = position;
  // Ondulation latérale du flot
  p.x += sin(uv.y * 9.0 - uTime * 2.6) * 0.22 * (1.0 - uv.y);
  p.z += cos(uv.y * 7.0 - uTime * 2.1) * 0.12;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FALL_FRAG = /* glsl */ `
uniform sampler2D tFoam;
uniform float uTime;
varying vec2 vUv;
varying float vEdge;
void main() {
  // Deux couches d'écume défilant à vitesses différentes
  float f1 = texture2D(tFoam, vec2(vUv.x * 1.6, vUv.y * 2.4 - uTime * 0.55)).r;
  float f2 = texture2D(tFoam, vec2(vUv.x * 3.1 + 0.37, vUv.y * 4.2 - uTime * 0.83)).r;
  float foam = f1 * 0.65 + f2 * 0.5;
  // Corps de la cascade : bleu glacier + écume blanche
  vec3 col = mix(vec3(0.35, 0.62, 0.80), vec3(0.95, 0.99, 1.0), foam);
  // Stries verticales rapides
  float streak = sin(vUv.x * 46.0 + f2 * 6.0) * 0.5 + 0.5;
  col += vec3(0.5, 0.75, 0.9) * streak * 0.18;
  float alpha = (0.42 + foam * 0.5) * smoothstep(0.0, 0.22, vEdge);
  // Couronne d'écume au sommet et à la base
  alpha += smoothstep(0.94, 1.0, vUv.y) * 0.3 + (1.0 - smoothstep(0.0, 0.10, vUv.y)) * 0.35;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.92));
}
`;

interface Mist {
  sprite: THREE.Sprite;
  base: number;
  phase: number;
}

export class Waterfall {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly mists: Mist[] = [];
  private time = 0;

  constructor(foam: THREE.Texture | null, puff: THREE.Texture | null) {
    this.group.name = 'waterfalls';
    const foamTex = foam ?? this.fallbackStripes();
    const puffTex = puff ?? foamTex;

    // Cascade ouest (face au promontoire, z = -30) + cascade est (z = 55)
    this.build(-30, -1, foamTex, puffTex);
    this.build(55, 1, foamTex, puffTex);
  }

  /** side -1 = paroi ouest, +1 = paroi est. */
  private build(z: number, side: -1 | 1, foamTex: THREE.Texture, puffTex: THREE.Texture): void {
    const cx = gorgeCenterX(z);
    const wallX = cx + side * (GORGE.halfWidth + 3.5);
    const rimY = snowHeight(wallX + side * 9, z);
    const floorY = GORGE.floor + 0.4;
    const height = Math.max(rimY - floorY + 2.5, 8);
    const width = 7;

    const material = new THREE.ShaderMaterial({
      vertexShader: FALL_VERT,
      fragmentShader: FALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        tFoam: { value: foamTex },
        uTime: { value: 0 },
      },
    });
    this.materials.push(material);

    const fall = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 6, 24), material);
    fall.position.set(wallX, floorY + height / 2 - 0.5, z);
    // Perpendiculaire à la paroi : la cascade regarde hors de la gorge
    fall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    fall.renderOrder = 5;
    this.group.add(fall);

    // Brume à la base (3 sprites pulsants)
    for (let i = 0; i < 3; i++) {
      const m = new THREE.SpriteMaterial({
        map: puffTex,
        alphaMap: puffTex,
        color: 0xbfe6f5,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(m);
      sprite.position.set(
        wallX + side * (1.5 + i * 1.8),
        floorY + 1.4 + i * 0.7,
        z + (i - 1) * 2.6,
      );
      const s = 9 + i * 3.5;
      sprite.scale.set(s, s * 0.55, 1);
      sprite.renderOrder = 6;
      this.group.add(sprite);
      this.mists.push({ sprite, base: 0.16 + i * 0.05, phase: i * 2.1 + z });
    }

    // Lueur cyan de la cascade (bloom + contraste froid)
    const light = new THREE.PointLight(0x7fd4f0, 9, 34, 1.7);
    light.position.set(wallX + side * 2.5, floorY + 3.5, z);
    this.group.add(light);
  }

  private fallbackStripes(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 10; i++) {
      ctx.fillRect(Math.random() * 64, 0, 2 + Math.random() * 4, 64);
    }
    return new THREE.CanvasTexture(canvas);
  }

  update(dt: number): void {
    this.time += dt;
    for (const m of this.materials) m.uniforms.uTime.value = this.time;
    for (const mist of this.mists) {
      mist.sprite.material.opacity = mist.base * (0.65 + 0.35 * Math.sin(this.time * 1.4 + mist.phase));
      mist.sprite.position.y += Math.sin(this.time * 0.9 + mist.phase) * 0.004;
    }
  }
}
