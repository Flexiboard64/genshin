import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationController } from './AnimationController';
import { normalizeMeshyMaterials } from '../core/materials';

/**
 * PNJ riggé Meshy (Marfoucha l'Oracle) : idle en boucle, se tourne vers le
 * joueur à proximité, reprend sa pose sinon. Bulle « ! » dorée au-dessus de
 * la tête quand une interaction de quête est disponible.
 * Le gabarit arrive ICI déjà calibré (échelle + ancrage) — cf. SkinnedEnemy.
 */

function makeMarkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 96, 96);
  ctx.font = 'bold 72px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffd94a';
  ctx.fillText('!', 48, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Npc {
  readonly object = new THREE.Group();
  readonly position: THREE.Vector3;
  private readonly anim: AnimationController;
  private readonly baseHeading: number;
  private heading: number;
  private readonly marker: THREE.Sprite;

  constructor(
    template: THREE.Object3D,
    clips: THREE.AnimationClip[],
    opts: { x: number; y: number; z: number; heading?: number; modelLift?: number },
  ) {
    // SkeletonUtils.clone : un clone(true) banal laisse le SkinnedMesh lié au
    // squelette du GABARIT (hors scène) → skin géant/noir figé au bind pose.
    const model = cloneSkeleton(template);
    // La calibration peut ancrer les OS (repli squelette) alors que le skin
    // rendu descend plus bas → modelLift remonte le modèle, la position
    // logique du groupe (interactions, focus, bulle) reste au sol.
    if (opts.modelLift) model.position.y += opts.modelLift;
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false;
      }
    });
    normalizeMeshyMaterials(model);
    // Lisibilité en intérieur : auto-éclairage marqué (salle du trône sombre,
    // robe de l'Oracle bleu nuit → quasi invisible sans ça à 25 m)
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
        std.emissive = new THREE.Color(0xffffff);
        std.emissiveIntensity = 0.38;
      }
    });
    this.object.add(model);
    this.anim = new AnimationController(model, clips);
    this.anim.setState('idle');

    this.position = new THREE.Vector3(opts.x, opts.y, opts.z);
    this.baseHeading = opts.heading ?? 0;
    this.heading = this.baseHeading;
    this.object.position.copy(this.position);
    this.object.rotation.y = this.heading;

    // Bulle de quête au-dessus de la tête
    this.marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeMarkerTexture(),
        transparent: true,
        depthWrite: false,
      }),
    );
    this.marker.scale.setScalar(0.95);
    this.marker.position.y = 2.45;
    this.marker.visible = false;
    this.object.add(this.marker);
  }

  /** Affiche/masque la bulle « ! » (quête disponible). */
  setMarker(visible: boolean): void {
    this.marker.visible = visible;
  }

  update(dt: number, elapsed: number, playerPos: THREE.Vector3): void {
    // Face au joueur à moins de 5 m, retour lent à la pose sinon
    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    const near = dx * dx + dz * dz < 25;
    const target = near ? Math.atan2(dx, dz) : this.baseHeading;
    let delta = ((target - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.heading += delta * Math.min(1, 4 * dt);
    this.object.rotation.y = this.heading;

    this.marker.position.y = 2.45 + Math.sin(elapsed * 2.2) * 0.07;
    this.anim.update(dt);
  }
}
