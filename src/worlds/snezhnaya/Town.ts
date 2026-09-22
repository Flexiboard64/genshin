import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { normalizeMeshyMaterials } from '../../core/materials';
import type { Collider } from '../../world/Vegetation';
import { TOWN, ravineCenterX, snowHeight } from './SnowTerrain';

interface PlaceOpts {
  rotY?: number;
  targetHeight: number;
  sink?: number;
  stretchX?: number;
  colliderR?: number;
  readable?: boolean;
}

interface PropInstance {
  x: number;
  z: number;
  rotY?: number;
  scale?: number;
}

/** Un nuage de fumée de cheminée (2 sprites qui montent en boucle). */
interface Chimney {
  sprites: THREE.Sprite[];
  phase: number;
}

const C = TOWN;

/** Coordonnées relatives au centre du village → absolues. */
function rel(dx: number, dz: number): { x: number; z: number } {
  return { x: C.x + dx, z: C.z + dz };
}

/**
 * Le village de Beryozka : place centrale pavée (fontaine gelée, braseros
 * éteints), 7 izbas aux fenêtres chaudes en anneau, clocher, puits, étals,
 * guirlandes de lanternes, fumée de cheminées, pont du ravin à l'ouest.
 * Les petits props répétés (lampes, clôtures, tonneaux, caisses) sont
 * instanciés pour limiter les draw calls.
 */
export class Town {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  /** Positions des 4 braseros du village (éteints au départ — quête). */
  readonly brazierPositions: { x: number; z: number }[] = [];
  /** Racine du modèle de fontaine gelée (enveloppée par MeltTargets). */
  fountainObject: THREE.Object3D | null = null;
  readonly fountainPos = { x: C.x, z: C.z };
  private readonly chimneys: Chimney[] = [];
  private readonly lampLights: THREE.PointLight[] = [];
  private time = 0;

  constructor(
    private readonly models: ReadonlyMap<string, GLTF>,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly smokeTexture: THREE.Texture | null,
  ) {
    this.group.name = 'town-beryozka';

    // ——— Place centrale : fontaine gelée, sculptures, braseros ———
    this.fountainObject = this.place('fountain-frozen', 0, 0, { targetHeight: 4.4, sink: 0.25, colliderR: 2.7, readable: true });
    this.place('ice-sculpture-swan', -5.5, 2.5, { targetHeight: 2.4, rotY: 0.9, sink: 0.1, colliderR: 0.9, readable: true });
    this.place('ice-sculpture-stag', 5.5, 2.5, { targetHeight: 3.1, rotY: -0.9, sink: 0.1, colliderR: 0.9, readable: true });
    for (const [bx, bz] of [[8, 0], [-8, 0], [0, 8], [0, -8]] as const) {
      const p = rel(bx, bz);
      this.place('fatui-brazier', bx, bz, { targetHeight: 1.5, sink: 0.06, colliderR: 0.7, readable: true });
      this.brazierPositions.push(p);
    }

    // ——— Anneau de maisons (fenêtres chaudes lisibles au crépuscule) ———
    const houses: { key: string; angle: number; r: number; h: number }[] = [
      { key: 'house-izba-a', angle: 15, r: 19, h: 5.2 },
      { key: 'house-izba-b', angle: 60, r: 21, h: 6.6 },
      { key: 'house-izba-a', angle: 105, r: 19, h: 5.6 },
      { key: 'house-merchant', angle: 150, r: 18, h: 5.4 },
      { key: 'house-izba-c', angle: 200, r: 21, h: 5.8 },
      { key: 'house-izba-b', angle: 250, r: 20, h: 6.2 },
      { key: 'house-izba-a', angle: 305, r: 19, h: 5.1 },
    ];
    for (const house of houses) {
      const a = (house.angle * Math.PI) / 180;
      const dx = Math.cos(a) * house.r;
      const dz = Math.sin(a) * house.r;
      const rotY = Math.atan2(-dx, -dz); // façade vers la place
      this.place(house.key, dx, dz, {
        targetHeight: house.h, rotY, sink: 0.3, colliderR: 3.6, readable: true,
      });
      this.chimney(dx, dz, house.h + 0.6);
    }
    this.place('bell-tower-village', ...this.polar(95, 26), { targetHeight: 10.5, rotY: this.polarRot(95), sink: 0.3, colliderR: 2.4, readable: true });
    this.place('well-frozen', ...this.polar(150, 11), { targetHeight: 2.8, rotY: 0.5, sink: 0.12, colliderR: 1.5 });

    // ——— Étals de marché (bord est de la place) ———
    this.place('market-stall-a', 13, 3, { targetHeight: 3.1, rotY: -1.4, sink: 0.12, colliderR: 1.8 });
    this.place('market-stall-b', 13, -4, { targetHeight: 3.2, rotY: -1.7, sink: 0.12, colliderR: 1.8 });

    // ——— Porches d'entrée (sentiers NE vers Mondstadt-spawn, NO vers la forêt) ———
    this.place('gate-village', 12, -12, { targetHeight: 4.6, rotY: 2.41, sink: 0.2, colliderR: 1.3, readable: true });
    this.place('gate-village', -13, -13, { targetHeight: 4.6, rotY: -2.92, sink: 0.2, colliderR: 1.3, readable: true });
    this.place('sign-post', 14, -13.5, { targetHeight: 2.4, rotY: 2.4, sink: 0.08, colliderR: 0.35 });

    // ——— Guirlandes de lanternes tendues entre les 4 lampadaires d'angle ———
    this.lanternSpan(8.5, 8.5, -8.5, 8.5);
    this.lanternSpan(8.5, -8.5, -8.5, -8.5);
    this.lanternSpan(8.5, 8.5, 8.5, -8.5);
    this.lanternSpan(-8.5, 8.5, -8.5, -8.5);

    // ——— Props de vie ———
    this.place('bench-snow', 4, 11, { targetHeight: 0.95, rotY: 3.3, sink: 0.05 });
    this.place('bench-snow', -11, -4, { targetHeight: 0.95, rotY: 0.6, sink: 0.05 });
    this.place('bench-snow', 11, 9, { targetHeight: 0.95, rotY: -2.3, sink: 0.05 });
    this.place('snowman', -15, 10, { targetHeight: 1.6, rotY: 0.4, sink: 0.05, readable: true });
    this.place('hay-cart', -18, -8, { targetHeight: 2.6, rotY: 1.1, sink: 0.15, colliderR: 1.6 });
    this.place('cart-wood', 16, 1, { targetHeight: 1.8, rotY: -1.5, sink: 0.1, colliderR: 1.1 });
    this.place('sled-wood', -14, -11, { targetHeight: 1.2, rotY: -0.4, sink: 0.06, colliderR: 0.9 });
    this.place('wood-pile', -19, 3, { targetHeight: 1.4, rotY: 0.2, sink: 0.08, colliderR: 1 });
    this.place('wood-pile', 3, -18, { targetHeight: 1.4, rotY: 1.8, sink: 0.08, colliderR: 1 });

    // ——— Props instanciés (1 draw call par type) ———
    this.instanced('lamp-post-village', [
      { x: 8.5, z: 8.5 }, { x: -8.5, z: 8.5 }, { x: 8.5, z: -8.5 }, { x: -8.5, z: -8.5 },
      { x: 17, z: 6 }, { x: -17, z: 6 }, { x: 6, z: 17 }, { x: -6, z: 17 },
    ], { targetHeight: 3.2, colliderR: 0.3 });
    this.instanced('barrel-frost', [
      { x: 14.5, z: 5.5 }, { x: 15.6, z: 4.1 }, { x: -17, z: -2 },
      { x: 6.5, z: 16.5 }, { x: -4, z: -17 },
    ], { targetHeight: 1.0, colliderR: 0.5 });
    this.instanced('crate-village', [
      { x: 13, z: 6.5, rotY: 0.4 }, { x: -15.5, z: -4.5, rotY: 2.2 },
      { x: 7.5, z: 15, rotY: 1.1 }, { x: -9, z: 14.5, rotY: -0.7 },
    ], { targetHeight: 1.0, colliderR: 0.6 });
    const fences: PropInstance[] = [];
    for (const deg of [30, 70, 110, 170, 210, 240, 280, 315, 345, 85]) {
      const [dx, dz] = this.polar(deg, 27);
      fences.push({ x: dx, z: dz, rotY: (deg * Math.PI) / 180 + Math.PI / 2, scale: 0.95 + (deg % 3) * 0.06 });
    }
    this.instanced('fence-wood', fences, { targetHeight: 1.3 });

    // ——— Pont du ravin (ouest, sentier village → forêt) ———
    this.bridge(18);

    // ——— Lumières chaudes des lampadaires (le village brille dans la nuit polaire) ———
    for (const [lx, lz] of [[8.5, 8.5], [-8.5, 8.5], [8.5, -8.5], [-8.5, -8.5], [17, 6], [-17, 6], [6, 17], [-6, 17]] as const) {
      const p = rel(lx, lz);
      const light = new THREE.PointLight(0xffbe78, 5, 15, 1.9);
      light.position.set(p.x, this.groundAt(p.x, p.z) + 3.05, p.z);
      this.group.add(light);
      this.lampLights.push(light);
    }
  }

  private polar(deg: number, r: number): [number, number] {
    const a = (deg * Math.PI) / 180;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  private polarRot(deg: number): number {
    const a = (deg * Math.PI) / 180;
    return Math.atan2(-Math.cos(a), -Math.sin(a));
  }

  private place(
    key: string,
    dx: number,
    dz: number,
    opts: PlaceOpts & { yOverride?: number },
  ): THREE.Object3D | null {
    const gltf = this.models.get(key);
    if (!gltf) {
      console.warn(`[Town] asset manquant "${key}" — ignoré`);
      return null;
    }
    const { x, z } = rel(dx, dz);
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    normalizeMeshyMaterials(root, 0.95);
    const box = new THREE.Box3().setFromObject(root);
    const srcHeight = Math.max(box.max.y - box.min.y, 0.01);
    const s = opts.targetHeight / srcHeight;
    root.scale.setScalar(s);
    if (opts.stretchX) root.scale.x *= opts.stretchX;
    root.rotation.y = opts.rotY ?? 0;
    const groundY = opts.yOverride ?? this.groundAt(x, z);
    root.position.set(x, groundY - box.min.y * s - (opts.sink ?? 0), z);
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    if (opts.readable) {
      root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          if (!std.isMeshStandardMaterial) continue;
          if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
          std.emissive = new THREE.Color(0xffffff);
          std.emissiveIntensity = 0.27;
        }
      });
    }
    this.group.add(root);
    if (opts.colliderR) this.colliders.push({ x, z, r: opts.colliderR });
    return root;
  }

  /** Instancie un prop répété : 1 InstancedMesh par sous-mesh du GLB. */
  private instanced(
    key: string,
    instances: PropInstance[],
    opts: { targetHeight: number; colliderR?: number; readable?: boolean },
  ): void {
    const gltf = this.models.get(key);
    if (!gltf) {
      console.warn(`[Town] asset manquant "${key}" — instanciation ignorée`);
      return;
    }
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    normalizeMeshyMaterials(root, 0.95);
    const box = new THREE.Box3().setFromObject(root);
    const srcHeight = Math.max(box.max.y - box.min.y, 0.01);
    const baseScale = opts.targetHeight / srcHeight;

    const matrices = instances.map((inst) => {
      const { x, z } = rel(inst.x, inst.z);
      const s = baseScale * (inst.scale ?? 1);
      const pos = new THREE.Vector3(x, this.groundAt(x, z) - box.min.y * s - 0.05, z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotY ?? 0);
      const m4 = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s, s));
      if (opts.colliderR) this.colliders.push({ x, z, r: opts.colliderR });
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
          std.emissiveIntensity = 0.27;
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

  /** Guirlande de lanternes tendue entre deux lampadaires (extrémités à leurs sommets). */
  private lanternSpan(ax: number, az: number, bx: number, bz: number): void {
    const gltf = this.models.get('lantern-string');
    if (!gltf) {
      console.warn('[Town] asset manquant "lantern-string" — guirlande ignorée');
      return;
    }
    const span = Math.hypot(bx - ax, bz - az);
    const root = gltf.scene.clone(true);
    root.updateMatrixWorld(true);
    normalizeMeshyMaterials(root, 0.95);
    const box = new THREE.Box3().setFromObject(root);
    const srcW = Math.max(box.max.x - box.min.x, 0.01);
    const srcH = Math.max(box.max.y - box.min.y, 0.01);
    // La guirlande couvre TOUTE la portée (scale X dédié) avec une retombée de ~1 m
    const sagH = 1.05;
    root.scale.set(span / srcW, sagH / srcH, sagH / srcH);
    root.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    const { x, z } = rel((ax + bx) / 2, (az + bz) / 2);
    // Extrémités juste sous le sommet des lampadaires (3,2 m)
    const endY =
      Math.max(
        this.groundAt(rel(ax, az).x, rel(ax, az).z),
        this.groundAt(rel(bx, bz).x, rel(bx, bz).z),
      ) + 2.98;
    root.position.set(x, endY - box.max.y * root.scale.y, z);
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false; // fil fin : ombre illisible, passe d'ombre allégée
      mesh.receiveShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
        std.emissive = new THREE.Color(0xffc38a); // lanternes allumées au crépuscule
        std.emissiveIntensity = 0.55;
      }
    });
    this.group.add(root);
  }

  /** Pont de bois franchissant le ravin à une coordonnée z. */
  private bridge(z: number): void {
    const cx = ravineCenterX(z);
    const rimY = Math.max(
      this.groundAt(cx - 10, z),
      this.groundAt(cx + 10, z),
    );
    const dx = cx - C.x;
    const dz = z - C.z;
    this.place('bridge-wood', dx, dz, {
      targetHeight: 1.7,
      rotY: Math.PI / 2,
      stretchX: 15 / 10,
      sink: -0.4,
      yOverride: rimY + 0.25,
    } as PlaceOpts & { yOverride: number });
  }

  /** Fumée de cheminée : 2 sprites qui montent, gonflent et s'estompent. */
  private chimney(dx: number, dz: number, topY: number): void {
    if (!this.smokeTexture) return;
    const { x, z } = rel(dx, dz);
    const sprites: THREE.Sprite[] = [];
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.smokeTexture,
        color: 0xdde4ee,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, this.groundAt(x, z) + topY, z);
      sprite.scale.setScalar(1.6);
      sprite.renderOrder = 6;
      sprite.userData.baseY = sprite.position.y;
      this.group.add(sprite);
      sprites.push(sprite);
    }
    this.chimneys.push({ sprites, phase: dx * 0.7 + dz * 1.3 });
  }

  update(dt: number): void {
    this.time += dt;
    // Fumée de cheminées : cycle de montée de 4 s décalé par sprite
    for (const ch of this.chimneys) {
      for (let i = 0; i < ch.sprites.length; i++) {
        const sprite = ch.sprites[i];
        const t = ((this.time * 0.25 + i * 0.5 + ch.phase) % 1 + 1) % 1;
        sprite.position.y = sprite.userData.baseY + t * 3.2;
        sprite.position.x += Math.sin(this.time * 0.6 + ch.phase) * 0.0012;
        const mat = sprite.material as THREE.SpriteMaterial;
        mat.opacity = 0.3 * (1 - t) * Math.min(1, t * 6);
        sprite.scale.setScalar(1.4 + t * 2.6);
      }
    }
    // Vacille doux des lampadaires
    for (let i = 0; i < this.lampLights.length; i++) {
      this.lampLights[i].intensity = 5 * (0.9 + 0.1 * Math.sin(this.time * 7 + i * 2.1) * Math.sin(this.time * 4.7 + i));
    }
  }
}

/** Hauteur du pont au-dessus du ravin (pour un futur ancrage praticable). */
export function bridgeDeckY(): number {
  const cx = ravineCenterX(18);
  return Math.max(snowHeight(cx - 10, 18), snowHeight(cx + 10, 18)) + 0.25;
}
