import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type UpdateFn = (dt: number, elapsed: number) => void;

const VignettePass = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.45 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      float vignette = 1.0 - smoothstep(0.42, 0.86, d) * uStrength;
      gl_FragColor = vec4(color.rgb * vignette, color.a);
    }
  `,
};

const FIXED_DT = 1 / 60;
const MAX_STEPS = 4;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly clock = new THREE.Clock();
  private readonly updaters: UpdateFn[] = [];
  private accumulator = 0;
  private elapsed = 0;
  private hitstopRemaining = 0;
  private hitstopScale = 0.06;

  /** Hitstop combat : le monde tourne au ralenti pendant `duration` s (temps réel). */
  hitstop(duration: number, scale = 0.06): void {
    this.hitstopRemaining = Math.max(this.hitstopRemaining, duration);
    this.hitstopScale = scale;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Accumulation sur toute la frame (toutes passes) — reset manuel dans tick
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1200,
    );

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.15,
      0.5,
      1.3,
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new ShaderPass(VignettePass));
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.handleResize);
  }

  onUpdate(fn: UpdateFn): void {
    this.updaters.push(fn);
  }

  start(): void {
    this.clock.start();
    this.renderer.setAnimationLoop(this.tick);
  }

  private readonly tick = (): void => {
    const frameDt = Math.min(this.clock.getDelta(), 0.1);
    let scaledDt = frameDt;
    if (this.hitstopRemaining > 0) {
      this.hitstopRemaining -= frameDt;
      scaledDt = frameDt * this.hitstopScale;
    }
    this.accumulator += scaledDt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      this.elapsed += FIXED_DT;
      for (const update of this.updaters) update(FIXED_DT, this.elapsed);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    this.renderer.info.reset();
    this.composer.render();
  };

  private readonly handleResize = (): void => {
    const { innerWidth: w, innerHeight: h } = window;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };
}
