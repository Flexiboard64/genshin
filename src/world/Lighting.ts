import * as THREE from 'three';

const SUN_OFFSET = new THREE.Vector3(55, 66, 30);

export interface LightingOpts {
  sunOffset?: THREE.Vector3;
  sunColor?: number;
  sunIntensity?: number;
  hemiSky?: number;
  hemiGround?: number;
  hemiIntensity?: number;
}

export class Lighting {
  private readonly sun: THREE.DirectionalLight;
  private readonly sunOffset: THREE.Vector3;

  constructor(scene: THREE.Scene, opts: LightingOpts = {}) {
    this.sunOffset = opts.sunOffset ?? SUN_OFFSET.clone();
    const hemisphere = new THREE.HemisphereLight(
      opts.hemiSky ?? 0xbfd4ff,
      opts.hemiGround ?? 0x8fa66b,
      opts.hemiIntensity ?? 0.35,
    );
    scene.add(hemisphere);

    this.sun = new THREE.DirectionalLight(opts.sunColor ?? 0xfff1d6, opts.sunIntensity ?? 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 280;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  /** Direction du soleil (normalisée), réutilisée par le shader d'eau. */
  get sunDirection(): THREE.Vector3 {
    return this.sunOffset.clone().normalize();
  }

  /** La frustum d'ombre suit le joueur pour garder des ombres nettes partout. */
  follow(target: THREE.Vector3): void {
    this.sun.position.set(
      target.x + this.sunOffset.x,
      target.y + this.sunOffset.y,
      target.z + this.sunOffset.z,
    );
    this.sun.target.position.copy(target);
  }
}
