import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { normalizeMeshyMaterials } from '../../core/materials';
import type { Collider } from '../../world/Vegetation';
import { makeFlame } from '../../fx/FlameMaterial';

/** Cell intérieur de la salle du trône, isolée dans le vide au sud de la carte. */
export const THRONE = {
  x: 0,
  z: -600,
  floorY: 0,
  width: 24,
  depth: 36,
  height: 12,
};
/** Porte extérieure (façade du palais) et intérieure (cell). */
export const THRONE_DOOR_OUT = { x: 0, z: -162.5 };
export const THRONE_DOOR_IN = { x: 0, z: -586 };

function roomMaterial(tex: THREE.Texture, repeatX: number, repeatY: number, rough = 0.85): THREE.MeshStandardMaterial {
  const map = tex.clone();
  map.repeat.set(repeatX, repeatY);
  map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0.05 });
}

/**
 * Salle du trône de la Tsarine : cell intérieur dédié (dans le vide à
 * (0,-600), invisible depuis l'extérieur), marbre givré, murs de brique de
 * glace, vitraux émissifs, colonnes, tapis royal, trône sur estrade,
 * candélabres à flammes shader, statues de garde, lustres, piédestal du
 * Cœur de l'Hiver. Entrée/sortie par téléportation à fondu (boot).
 */
export class ThroneRoom {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  /** Piédestal central (le Cœur recomposé apparaît ici à la finale). */
  readonly heartPedestalPos = new THREE.Vector3(THRONE.x + 3.2, THRONE.floorY, THRONE.z - 13);
  /** Emplacement du PNJ Oracle, devant le trône. */
  readonly oraclePos = new THREE.Vector3(THRONE.x - 2.2, THRONE.floorY, THRONE.z - 12);
  private readonly flames: THREE.Mesh[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private heartCrystal: THREE.Mesh | null = null;
  private heartLight: THREE.PointLight | null = null;
  private time = 0;

  constructor(
    private readonly models: ReadonlyMap<string, GLTF>,
    textures: { floor: THREE.Texture; walls: THREE.Texture; carpet: THREE.Texture },
  ) {
    this.group.name = 'throne-room';
    const { x: cx, z: cz, width: W, depth: D, height: H, floorY: FY } = THRONE;

    // ——— Coquille : sol, 4 murs, plafond ———
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, D), roomMaterial(textures.floor, 6, 9));
    floor.position.set(cx, FY - 0.3, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    const wallMat = roomMaterial(textures.walls, 8, 3);
    const mkWall = (w: number, d: number, px: number, pz: number) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      wall.position.set(px, FY + H / 2, pz);
      wall.receiveShadow = true;
      this.group.add(wall);
    };
    mkWall(W, 1, cx, cz - D / 2); // nord (trône)
    mkWall(W, 1, cx, cz + D / 2); // sud (porte)
    mkWall(1, D, cx - W / 2, cz);
    mkWall(1, D, cx + W / 2, cz);
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(W, 1, D), wallMat);
    ceiling.position.set(cx, FY + H, cz);
    this.group.add(ceiling);

    // ——— Tapis royal (porte → estrade) ———
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, D - 10),
      roomMaterial(textures.carpet, 1, 6, 0.95),
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(cx, FY + 0.012, cz + 4);
    carpet.receiveShadow = true;
    this.group.add(carpet);

    // ——— Estrade du trône (3 degrés) ———
    const daisMat = roomMaterial(textures.floor, 3, 2, 0.7);
    const steps: [number, number, number, number][] = [
      [9, 0.18, 6, cz - D / 2 + 5.4],
      [7, 0.36, 4.6, cz - D / 2 + 4.8],
      [5.4, 0.54, 3.6, cz - D / 2 + 4.2],
    ];
    for (const [w, y, d, pz] of steps) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, y, d), daisMat);
      step.position.set(cx, FY + y / 2, pz);
      step.receiveShadow = true;
      this.group.add(step);
    }

    // ——— Trône + piédestal du Cœur ———
    this.place('throne-ornate', cx, cz - D / 2 + 4.1, {
      targetHeight: 3.4, rotY: Math.PI, yOverride: FY + 0.54, colliderR: 1.5, readable: true,
    });
    this.place('pedestal-heart', this.heartPedestalPos.x, this.heartPedestalPos.z, {
      targetHeight: 1.35, yOverride: FY, colliderR: 0.7, readable: true,
    });

    // ——— Colonnes instanciées (2 rangées) ———
    const columns: { x: number; z: number }[] = [];
    for (let i = 0; i < 4; i++) {
      columns.push({ x: cx - 7, z: cz - 12 + i * 7.5 });
      columns.push({ x: cx + 7, z: cz - 12 + i * 7.5 });
    }
    this.instanced('column-palace', columns, { targetHeight: H - 1.5, colliderR: 0.9 });

    // ——— Vitraux émissifs : 3 au nord derrière le trône, 1 par mur latéral ———
    const windows: { x: number; z: number; rotY: number }[] = [
      { x: cx - 6.5, z: cz - D / 2 + 0.6, rotY: 0 },
      { x: cx, z: cz - D / 2 + 0.6, rotY: 0 },
      { x: cx + 6.5, z: cz - D / 2 + 0.6, rotY: 0 },
      { x: cx - W / 2 + 0.6, z: cz, rotY: Math.PI / 2 },
      { x: cx + W / 2 - 0.6, z: cz, rotY: -Math.PI / 2 },
    ];
    for (const win of windows) {
      this.place('stained-glass-cryo', win.x, win.z, {
        targetHeight: 6.5, rotY: win.rotY, yOverride: FY + 2.6, emissiveBoost: 1.35,
      });
    }

    // ——— Bannières de la Tsarine sur les murs latéraux ———
    for (const [bx, bz, rotY] of [
      [cx - W / 2 + 0.7, cz - 9, Math.PI / 2],
      [cx - W / 2 + 0.7, cz + 9, Math.PI / 2],
      [cx + W / 2 - 0.7, cz - 9, -Math.PI / 2],
      [cx + W / 2 - 0.7, cz + 9, -Math.PI / 2],
    ] as const) {
      this.place('banner-tsaritsa', bx, bz, { targetHeight: 5.5, rotY, yOverride: FY + 3.4, readable: true });
    }

    // ——— Candélabres + flammes le long du tapis ———
    const candelabra: { x: number; z: number }[] = [];
    for (const [ox, oz] of [[-3.4, 10], [3.4, 10], [-3.4, 3], [3.4, 3], [-3.4, -4], [3.4, -4]] as const) {
      candelabra.push({ x: cx + ox, z: cz + oz });
    }
    this.instanced('candelabra', candelabra, { targetHeight: 1.8, colliderR: 0.4, readable: true });
    candelabra.forEach((c, i) => {
      const flame = makeFlame(0.5, i * 1.7);
      flame.position.set(c.x, FY + 1.55, c.z);
      this.group.add(flame);
      this.flames.push(flame);
      if (i % 2 === 0) {
        const light = new THREE.PointLight(0xffb36b, 7, 13, 1.8);
        light.position.set(c.x, FY + 2.3, c.z);
        this.group.add(light);
        this.lights.push(light);
      }
    });

    // ——— Statues de garde encadrant l'estrade ———
    this.instanced('guard-statue', [
      { x: cx - 5.6, z: cz - D / 2 + 6.5, rotY: 0 },
      { x: cx + 5.6, z: cz - D / 2 + 6.5, rotY: 0 },
      { x: cx - 9.5, z: cz - D / 2 + 12, rotY: 0.3 },
      { x: cx + 9.5, z: cz - D / 2 + 12, rotY: -0.3 },
    ], { targetHeight: 2.7, colliderR: 0.8, readable: true });

    // ——— Lustres suspendus ———
    for (const lz of [cz + 8, cz, cz - 8]) {
      this.place('chandelier-ice', cx, lz, { targetHeight: 3.1, yOverride: FY + H - 3.4, readable: true });
    }

    // ——— Lumière d'ambiance : bleu froid derrière le trône, douce au centre ———
    const throneGlow = new THREE.PointLight(0x7fc8ff, 9, 20, 1.6);
    throneGlow.position.set(cx, FY + 4.5, cz - D / 2 + 2.5);
    this.group.add(throneGlow);
    const hallGlow = new THREE.PointLight(0xbfd8ff, 4, 30, 1.4);
    hallGlow.position.set(cx, FY + 8, cz + 6);
    this.group.add(hallGlow);

    // ——— Cœur de l'Hiver (invisible jusqu'à la finale) ———
    const heartGeo = new THREE.OctahedronGeometry(0.55, 0);
    const heartMat = new THREE.MeshStandardMaterial({
      color: 0x9fdcff,
      emissive: 0x55bfff,
      emissiveIntensity: 2.2,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.95,
    });
    this.heartCrystal = new THREE.Mesh(heartGeo, heartMat);
    this.heartCrystal.position.copy(this.heartPedestalPos).y = THRONE.floorY + 1.75;
    this.heartCrystal.visible = false;
    this.group.add(this.heartCrystal);
    this.heartLight = new THREE.PointLight(0x66c8ff, 0, 18, 1.5);
    this.heartLight.position.copy(this.heartCrystal.position);
    this.group.add(this.heartLight);
  }

  /** Le Cœur recomposé apparaît sur le piédestal (finale). */
  setHeartVisible(visible: boolean): void {
    if (this.heartCrystal) this.heartCrystal.visible = visible;
    if (this.heartLight) this.heartLight.intensity = visible ? 14 : 0;
  }

  /** Position du joueur à l'intérieur de la cell ? */
  isInside(pos: THREE.Vector3): boolean {
    return (
      Math.abs(pos.x - THRONE.x) < THRONE.width / 2 + 2 &&
      Math.abs(pos.z - THRONE.z) < THRONE.depth / 2 + 2
    );
  }

  /** Contraint le joueur dans les murs (appelé chaque frame quand inside). */
  clampInside(pos: THREE.Vector3): void {
    const mx = THRONE.width / 2 - 1.1;
    const mz = THRONE.depth / 2 - 1.1;
    pos.x = THREE.MathUtils.clamp(pos.x, THRONE.x - mx, THRONE.x + mx);
    pos.z = THREE.MathUtils.clamp(pos.z, THRONE.z - mz, THRONE.z + mz);
  }

  private place(
    key: string,
    x: number,
    z: number,
    opts: { targetHeight: number; rotY?: number; yOverride: number; colliderR?: number; readable?: boolean; emissiveBoost?: number },
  ): THREE.Object3D | null {
    const gltf = this.models.get(key);
    if (!gltf) {
      console.warn(`[ThroneRoom] asset manquant "${key}" — ignoré`);
      return null;
    }
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    normalizeMeshyMaterials(root, 0.95);
    const box = new THREE.Box3().setFromObject(root);
    const srcHeight = Math.max(box.max.y - box.min.y, 0.01);
    const s = opts.targetHeight / srcHeight;
    root.scale.setScalar(s);
    root.rotation.y = opts.rotY ?? 0;
    root.position.set(x, opts.yOverride - box.min.y * s, z);
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    const boost = opts.emissiveBoost ?? (opts.readable ? 0.4 : 0);
    if (boost > 0) {
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (!std.isMeshStandardMaterial) continue;
          if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
          std.emissive = new THREE.Color(0xffffff);
          std.emissiveIntensity = boost;
        }
      });
    }
    this.group.add(root);
    if (opts.colliderR) this.colliders.push({ x, z, r: opts.colliderR });
    return root;
  }

  private instanced(
    key: string,
    instances: { x: number; z: number; rotY?: number }[],
    opts: { targetHeight: number; colliderR?: number; readable?: boolean },
  ): void {
    const gltf = this.models.get(key);
    if (!gltf) {
      console.warn(`[ThroneRoom] asset manquant "${key}" — instanciation ignorée`);
      return;
    }
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    normalizeMeshyMaterials(root, 0.95);
    const box = new THREE.Box3().setFromObject(root);
    const srcHeight = Math.max(box.max.y - box.min.y, 0.01);
    const s = opts.targetHeight / srcHeight;
    const matrices = instances.map((inst) => {
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(inst.x, THRONE.floorY - box.min.y * s, inst.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotY ?? 0),
        new THREE.Vector3(s, s, s),
      );
      if (opts.colliderR) this.colliders.push({ x: inst.x, z: inst.z, r: opts.colliderR });
      return m4;
    });
    const meshes: THREE.Mesh[] = [];
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
    });
    for (const src of meshes) {
      const geometry = src.geometry.clone().applyMatrix4(src.matrixWorld);
      const material = (Array.isArray(src.material) ? src.material[0] : src.material).clone();
      if (opts.readable) {
        const std = material as THREE.MeshStandardMaterial;
        if (std.isMeshStandardMaterial) {
          if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
          std.emissive = new THREE.Color(0xffffff);
          std.emissiveIntensity = 0.35;
        }
      }
      const instancedMesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      for (let i = 0; i < matrices.length; i++) instancedMesh.setMatrixAt(i, matrices[i]);
      instancedMesh.instanceMatrix.needsUpdate = true;
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      instancedMesh.name = `${key}-instanced`;
      this.group.add(instancedMesh);
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const flame of this.flames) {
      (flame.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    }
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].intensity = 7 * (0.9 + 0.1 * Math.sin(this.time * 7.3 + i * 2.3));
    }
    if (this.heartCrystal?.visible) {
      this.heartCrystal.rotation.y += dt * 0.8;
      this.heartCrystal.position.y = THRONE.floorY + 1.75 + Math.sin(this.time * 1.4) * 0.08;
    }
  }
}
