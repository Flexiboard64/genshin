import * as THREE from 'three';
import { Enemy, type EnemyConfig, type EnemyUpdateCtx } from './Enemy';
import { AnimationController, type CombatState } from '../AnimationController';
import { normalizeMeshyMaterials } from '../../core/materials';
import { bottomCurveAt } from './measureSkinned';

/**
 * Ennemi riggé Meshy : AnimationController partagé avec le joueur, locomotion
 * idle/walk/run + one-shots (attaque, réaction, mort). La mort reste clampée
 * sur la dernière frame puis la glisse sous terre (classe de base) s'applique.
 *
 * IMPORTANT : le modèle arrive ICI déjà calibré (échelle + ancrage au sol) par
 * `calibrateSkinnedModel` sur le gabarit (EnemyManager) — les bbox statiques
 * des rigs Meshy ne reflètent pas le rendu skinné (unités cm/m mélangées).
 */
export abstract class SkinnedEnemy extends Enemy {
  protected readonly anim: AnimationController;
  protected readonly model: THREE.Object3D;
  private currentLoco = '';
  /** Ancre statique calibrée (mesurée sur le point le plus bas du cycle idle). */
  private readonly baseAnchorY: number;
  /** Offset d'ancrage animé amorti (re-plaquage pose par pose). */
  private anchorOffset = 0;

  constructor(config: EnemyConfig, model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    super(config);
    this.model = model;
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false;
      }
    });
    normalizeMeshyMaterials(model);
    this.boostReadability(model);
    this.cacheMaterials(model);
    this.object.add(model);
    this.anim = new AnimationController(model, clips);
    this.baseAnchorY = model.position.y;
  }

  /**
   * Lisibilité créature (fidélité Genshin : les mobs restent lisibles à l'ombre) :
   * les GLB raffinés Meshy embarquent la texture de base en emissiveMap — on la
   * réactive en auto-illumination douce au lieu de la laisser à 0.
   */
  private boostReadability(root: THREE.Object3D): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        if (std.emissiveMap) {
          std.emissive.setRGB(0.34, 0.32, 0.3);
          std.emissiveIntensity = 1;
        }
        std.envMapIntensity = Math.max(std.envMapIntensity, 0.55);
      }
    });
  }

  /** Attache un accessoire (massue) à un os du squelette. */
  protected attachToBone(pattern: RegExp, accessory: THREE.Object3D): boolean {
    let bone: THREE.Object3D | null = null;
    this.model.traverse((child) => {
      if (!bone && pattern.test(child.name)) bone = child;
    });
    if (!bone) return false;
    (bone as THREE.Object3D).add(accessory);
    return true;
  }

  /**
   * Variante qui compense l'échelle monde de l'os (armature Meshy 0.01 ×
   * échelle calibrée du modèle) pour que l'accessoire garde sa taille voulue.
   */
  protected attachToBoneScaled(pattern: RegExp, accessory: THREE.Object3D, scale: number): boolean {
    let bone: THREE.Object3D | null = null;
    this.model.traverse((child) => {
      if (!bone && pattern.test(child.name)) bone = child;
    });
    if (!bone) return false;
    this.object.updateMatrixWorld(true);
    const ws = new THREE.Vector3();
    (bone as THREE.Object3D).getWorldScale(ws);
    accessory.scale.setScalar(scale / Math.max(ws.x, 1e-4));
    (bone as THREE.Object3D).add(accessory);
    return true;
  }

  protected locomotion(state: 'idle' | 'walk' | 'run' | 'combatIdle'): void {
    if (this.currentLoco === state) return;
    this.currentLoco = state;
    this.anim.setState(state, 0.24);
  }

  protected playCombat(state: CombatState, timeScale = 1): number {
    this.currentLoco = '';
    return this.anim.playOnce(state, { timeScale, fade: 0.1 });
  }

  protected override onHurt(): void {
    this.anim.playOnce('hurt', { timeScale: 1.25, fade: 0.06 });
    this.currentLoco = '';
  }

  protected override onDeath(): void {
    this.anim.playOnce('dead', { fade: 0.12 });
    this.currentLoco = '';
  }

  protected override onReset(): void {
    this.currentLoco = '';
    this.anim.setState('idle', 0);
  }

  protected tickVisual(dt: number, _ctx: EnemyUpdateCtx): void {
    // La locomotion ne s'applique que hors one-shots (attaque/hurt/dead)
    if (this.state === 'idle' || this.state === 'patrol' || this.state === 'chase' || this.state === 'return') {
      if (this.state === 'chase') this.locomotion('run');
      else if (this.state === 'patrol' || this.state === 'return') this.locomotion('walk');
      else this.locomotion(this.aggroed && this.anim.has('combatIdle') ? 'combatIdle' : 'idle');
    }
    this.anim.update(dt);
    this.applyAnimatedAnchor(dt);
  }

  /**
   * Re-plaquage au sol pose par pose : les clips Meshy « en place » balaient
   * les pieds en l'air au milieu de la foulée (jusqu'à ~0,6 m de décollement
   * visuel) — la courbe d'ancrage mesurée au boot (bas RENDU par instant du
   * cycle, la seule mesure fiable pour ces rigs aux unités mélangées) indique
   * de combien descendre le corps pour que le point bas de la pose COURANTE
   * touche le sol. Amorti court pour lisser les transitions de clips.
   */
  private applyAnimatedAnchor(dt: number): void {
    let target = 0;
    const ct = this.anim.currentClipTime();
    if (ct) {
      const bottom = bottomCurveAt(ct.clip, ct.t);
      const min = ct.clip.userData.minBottom as number | undefined;
      if (bottom !== null && min !== undefined && Number.isFinite(min)) target = min - bottom;
    }
    if (!Number.isFinite(this.anchorOffset)) this.anchorOffset = 0;
    this.anchorOffset += (target - this.anchorOffset) * Math.min(1, 18 * dt);
    this.model.position.y = this.baseAnchorY + this.anchorOffset;
  }
}
