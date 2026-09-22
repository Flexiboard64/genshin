import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Input } from '../core/Input';
import { AnimationController } from './AnimationController';
import { normalizeMeshyMaterials } from '../core/materials';
import type { Collider } from '../world/Vegetation';

export interface PlayerEnv {
  waterLevel?: number;
  colliders?: readonly Collider[];
  /** Appelé à la plongée (entrée dans l'eau) — gerbe + anneau de mousse. */
  onSplash?: (x: number, y: number, z: number, strength: number) => void;
  /** Appelé pendant la nage sous l'eau — bulle qui remonte. */
  onBubble?: (x: number, y: number, z: number) => void;
}

const WALK_SPEED = 4.2;
const SPRINT_SPEED = 7.4;
const SWIM_SPEED = 3.4;
const SWIM_SPRINT_SPEED = 5.2;
const SWIM_DEPTH_ENTER = 0.6; // profondeur où la marche devient nage
const SWIM_DEPTH_EXIT = 0.42; // hystérésis pour le retour à la marche
const SWIM_SUBMERGE_MOVE = 1.45; // nage SOUS l'eau : corps entièrement immergé
const SWIM_SUBMERGE_IDLE = 1.28; // sur place, tête hors de l'eau
const SWIM_DRAIN = 7; // endurance/s en nage active
const SWIM_IDLE_DRAIN = 2.5;
const ACCEL = 14;
const ROT_ACCEL = 13;
const JUMP_VELOCITY = 7.6;
const GRAVITY = 22;
export const STAMINA_MAX = 200;
const SPRINT_DRAIN = 15;
const STAMINA_REGEN = 12;
const MODEL_HEIGHT = 1.62;
const STEP_UP_SPEED = 8; // m/s de grimpe lissée sur une marche d'escalier
const SNAP_DOWN_DISTANCE = 0.55; // descente : rester collé si le sol tombe de moins de ça
const GLIDE_SPEED = 12; // m/s avant en planage
const GLIDE_FALL = 2.3; // vitesse de descente en planage
const GLIDE_DRAIN = 5; // endurance/s en planage
const GLIDE_TURN = 2.4; // rad/s de virage vers le cap caméra

/**
 * Les exports Meshy contiennent des pistes d'échelle qui cassent la normalisation du modèle,
 * et certains clips (ex. Swim_Forward) ont du root-motion : le Hips translate de centaines
 * d'unités, ce qui fait pivoter le personnage en virage. On retire la dérive linéaire nette
 * des pistes de position du Hips (bob/oscillation du cycle conservés).
 */
export function sanitizeClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  clip.tracks = clip.tracks.filter((track) => !track.name.endsWith('.scale'));
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position') || !/hips|root/i.test(track.name)) continue;
    const times = track.times;
    const n = times.length;
    if (n < 2) continue;
    const v = track.values;
    const dx = v[(n - 1) * 3] - v[0];
    const dy = v[(n - 1) * 3 + 1] - v[1];
    const dz = v[(n - 1) * 3 + 2] - v[2];
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.5) continue; // déjà en place
    const t0 = times[0];
    const span = Math.max(times[n - 1] - t0, 1e-6);
    for (let i = 0; i < n; i++) {
      const k = (times[i] - t0) / span;
      v[i * 3] -= dx * k;
      v[i * 3 + 1] -= dy * k;
      v[i * 3 + 2] -= dz * k;
    }
  }
  return clip;
}

export class Player {
  readonly object = new THREE.Group();
  readonly position = new THREE.Vector3(0, 0, 0);
  stamina = STAMINA_MAX;
  isSprinting = false;
  isSwimming = false;
  /** Verrous pilotés par le combat : ignore les entrées de déplacement / d'animation. */
  movementLock = false;
  /** Verrou dialogues / cinématiques (équivalent movementLock, pilier indépendant). */
  movementLocked = false;
  animOverride = false;
  /** Pose au repos hors déplacement (combatIdle près des ennemis). */
  preferredIdle: 'idle' | 'combatIdle' = 'idle';

  // ——— Planage (débloqué par la quête « Le Cœur de l'Hiver ») ———
  /** Planeur déployé. */
  gliding = false;
  /** Autorise le déploiement (offert par l'Oracle). */
  glideUnlocked = false;
  /** Poussée verticale des courants ascendants (fixée par Glider, m/s). */
  glideLift = 0;
  private wings: THREE.Object3D | null = null;
  private wingsBone: THREE.Object3D | null = null;
  private headBone: THREE.Object3D | null = null;
  private readonly wingTmpQ1 = new THREE.Quaternion();
  private readonly wingTmpQ2 = new THREE.Quaternion();
  private readonly wingTmpV = new THREE.Vector3();
  private readonly wingTmpM = new THREE.Matrix4();

  private readonly anim: AnimationController | null = null;
  private model: THREE.Object3D | null = null;
  private speed = 0;
  private heading = 0;
  private verticalVelocity = 0;
  private grounded = true;
  private staminaCooldown = 0;
  private lastSafeX = 0;
  private lastSafeZ = 0;
  private bubbleTimer = 0;
  private diveDip = 0; // enfoncement transitoire à la plongée

  constructor(
    gltf: GLTF | undefined,
    clips: THREE.AnimationClip[],
    private readonly input: Input,
  ) {
    if (gltf) {
      const model = gltf.scene;
      this.model = model;
      const box = new THREE.Box3().setFromObject(model);
      const height = Math.max(box.max.y - box.min.y, 0.01);
      const scale = MODEL_HEIGHT / height;
      model.scale.setScalar(scale);
      model.position.y = -box.min.y * scale;
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.frustumCulled = false;
        }
      });
      normalizeMeshyMaterials(model);
      this.object.add(model);
      const allClips = [...gltf.animations, ...clips].map(sanitizeClip);
      this.anim = new AnimationController(model, allClips);
    } else {
      const fallback = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.35, 0.9, 6, 12),
        new THREE.MeshStandardMaterial({ color: 0xd8c9a3 }),
      );
      fallback.position.y = 0.95;
      fallback.castShadow = true;
      this.object.add(fallback);
      console.warn('[Player] hero.glb indisponible — capsule de substitution utilisée');
    }
  }

  /** Contrôleur d'animation (combat : playOnce, durées). */
  get controller(): AnimationController | null {
    return this.anim;
  }

  get headingAngle(): number {
    return this.heading;
  }

  set headingAngle(value: number) {
    this.heading = value;
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  /** Cherche un os/objet par nom dans le modèle (attache d'arme). */
  findBone(pattern: RegExp): THREE.Object3D | null {
    if (!this.model) return null;
    let found: THREE.Object3D | null = null;
    this.model.traverse((child) => {
      if (!found && pattern.test(child.name)) found = child;
    });
    return found;
  }

  /** Liste des noms d'os (diagnostic). */
  listBones(): string[] {
    const names: string[] = [];
    this.model?.traverse((child) => {
      if ((child as THREE.Bone).isBone) names.push(child.name);
    });
    return names;
  }

  /** Ramène au dernier point sûr (mort noyade ou combat). */
  respawnAtLastSafe(groundAt: (x: number, z: number) => number): void {
    this.position.set(this.lastSafeX, groundAt(this.lastSafeX, this.lastSafeZ), this.lastSafeZ);
    this.stamina = 120;
    this.isSwimming = false;
    this.gliding = false;
    if (this.wings) this.wings.visible = false;
    this.speed = 0;
    this.verticalVelocity = 0;
  }

  /** Ailes de planeur : attachées au torse, calées en continu par updateWings. */
  setWingsModel(obj: THREE.Object3D | null): void {
    if (!obj) return;
    this.wings = obj;
    const bone = this.findBone(/spine|chest|upper/i);
    if (!bone) {
      obj.position.set(0, 1.15, -0.28);
      obj.visible = false;
      this.object.add(obj);
      return;
    }
    this.wingsBone = bone;
    this.headBone = this.findBone(/^head$/i);
    // L'échelle monde de l'os ≠ 1 (rigs Meshy) : compenser pour un rendu taille réelle
    const ws = new THREE.Vector3();
    bone.getWorldScale(ws);
    obj.scale.setScalar(Player.WING_SCALE / Math.max(ws.y, 1e-6));
    obj.visible = false;
    bone.add(obj);
  }

  private static readonly WING_TILT = 0.12; // relevage des pointes avant (rad)
  private static readonly WING_LIFT = 0.34; // au-dessus de la tête (m)
  private static readonly WING_BACK = 0.3; // recul derrière l'axe du corps (m)
  private static readonly WING_SCALE = 0.85; // échelle monde du modèle d'ailes
  /** Orientation du modèle d'ailes : pointes effilées vers l'avant (yaw π), dessus étoilé en haut. */
  private static readonly WING_MODEL_Q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(Player.WING_TILT, Math.PI, 0, 'YXZ'),
  );

  /**
   * Recale les ailes sur la pose courante (planage) : envergure perpendiculaire
   * au cap, voilure horizontale au-dessus de la tête, pointes vers l'avant.
   * Calcul dans le repère de l'os (worldQ⁻¹ × cible) — indépendant des
   * conventions d'axes du rig Meshy.
   */
  private updateWings(): void {
    const wings = this.wings;
    const bone = this.wingsBone;
    if (!wings || !bone) return;
    bone.getWorldQuaternion(this.wingTmpQ1);
    this.wingTmpQ2.copy(this.object.quaternion).multiply(Player.WING_MODEL_Q);
    wings.quaternion.copy(this.wingTmpQ1.invert().multiply(this.wingTmpQ2));
    if (this.headBone) {
      this.headBone.getWorldPosition(this.wingTmpV);
    } else {
      this.wingTmpV.copy(this.position);
      this.wingTmpV.y += 1.4;
    }
    this.wingTmpV.y += Player.WING_LIFT;
    this.wingTmpV.x -= Math.sin(this.heading) * Player.WING_BACK;
    this.wingTmpV.z -= Math.cos(this.heading) * Player.WING_BACK;
    this.wingTmpM.copy(bone.matrixWorld).invert();
    this.wingTmpV.applyMatrix4(this.wingTmpM);
    wings.position.copy(this.wingTmpV);
  }

  /** Déploie / replie le planeur. */
  private startGlide(): void {
    this.gliding = true;
    this.verticalVelocity = -GLIDE_FALL * 0.5;
    if (this.wings) this.wings.visible = true;
  }

  private stopGlide(): void {
    this.gliding = false;
    this.glideLift = 0;
    if (this.wings) this.wings.visible = false;
  }

  update(
    dt: number,
    cameraYaw: number,
    groundAt: (x: number, z: number) => number,
    env?: PlayerEnv,
  ): void {
    const axis = this.input.axis();
    const locked = this.movementLock || this.movementLocked;
    const x = locked ? 0 : axis.x;
    const z = locked ? 0 : axis.z;
    const moving = x !== 0 || z !== 0;

    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    let dirX = x * cos + z * sin;
    let dirZ = -x * sin + z * cos;
    const len = Math.hypot(dirX, dirZ);
    if (len > 1) {
      dirX /= len;
      dirZ /= len;
    }

    // Bascule marche ↔ nage selon la profondeur sous les pieds
    const waterLevel = env?.waterLevel;
    if (waterLevel !== undefined) {
      const depthHere = waterLevel - groundAt(this.position.x, this.position.z);
      if (!this.isSwimming && depthHere > SWIM_DEPTH_ENTER) {
        this.isSwimming = true;
        // Plongée : gerbe proportionnelle à la vitesse (course et/ou chute)
        const strength = THREE.MathUtils.clamp(
          0.55 + (this.speed / SPRINT_SPEED) * 0.7 + (Math.abs(this.verticalVelocity) / 9) * 0.75,
          0.5,
          1.8,
        );
        env?.onSplash?.(this.position.x, waterLevel, this.position.z, strength);
        this.diveDip = Math.min(strength, 1.8) * 0.45;
      } else if (this.isSwimming && depthHere < SWIM_DEPTH_EXIT) {
        this.isSwimming = false;
      }
    }
    const swimming = this.isSwimming;

    // Marcher dans l'eau peu profonde ralentit
    const inWater =
      waterLevel !== undefined &&
      !swimming &&
      this.grounded &&
      this.position.y < waterLevel + 0.12;

    this.isSprinting =
      !locked && !this.gliding && this.input.sprinting && moving && this.stamina > 0.5 && !inWater;
    const baseSpeed = swimming
      ? this.isSprinting
        ? SWIM_SPRINT_SPEED
        : SWIM_SPEED
      : this.isSprinting
        ? SPRINT_SPEED
        : WALK_SPEED;
    const targetSpeed = moving ? baseSpeed * (inWater ? 0.55 : 1) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, targetSpeed, ACCEL, dt);

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - (swimming ? SWIM_DRAIN : SPRINT_DRAIN) * dt);
      this.staminaCooldown = 0.9;
    } else if (swimming) {
      // La nage épuise lentement, même sur place — pas de régénération dans l'eau
      this.stamina = Math.max(0, this.stamina - (moving ? SWIM_DRAIN * 0.6 : SWIM_IDLE_DRAIN) * dt);
    } else {
      this.staminaCooldown -= dt;
      if (this.staminaCooldown <= 0) {
        this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);
      }
    }

    if (moving) {
      const targetHeading = Math.atan2(dirX, dirZ);
      let delta = ((targetHeading - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.heading += delta * Math.min(1, ROT_ACCEL * dt);
    }
    if (this.gliding) {
      // Planage : avance à vitesse fixe, virage doux vers le cap caméra
      let delta = ((cameraYaw - this.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.heading += delta * Math.min(1, GLIDE_TURN * dt);
    }
    this.object.rotation.y = this.heading;

    if (this.gliding) {
      this.position.x += Math.sin(this.heading) * GLIDE_SPEED * dt;
      this.position.z += Math.cos(this.heading) * GLIDE_SPEED * dt;
    } else {
      this.position.x += dirX * this.speed * dt;
      this.position.z += dirZ * this.speed * dt;
    }

    // Collisions cylindriques (troncs d'arbres, gros rochers) : repousse horizontale
    if (env?.colliders) {
      for (const c of env.colliders) {
        const dx = this.position.x - c.x;
        const dz = this.position.z - c.z;
        const minD = c.r + 0.35;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          this.position.x = c.x + (dx / d) * minD;
          this.position.z = c.z + (dz / d) * minD;
        }
      }
    }

    const ground = groundAt(this.position.x, this.position.z);

    if (swimming && waterLevel !== undefined) {
      // Nage : pas de gravité, flottaison amortie sous la surface
      this.verticalVelocity = 0;
      this.grounded = true;
      const submerge = this.speed > 0.4 ? SWIM_SUBMERGE_MOVE : SWIM_SUBMERGE_IDLE;
      const targetY = Math.max(waterLevel - submerge - this.diveDip, ground + 0.12);
      this.position.y = THREE.MathUtils.damp(this.position.y, targetY, 7, dt);
      this.diveDip = Math.max(0, this.diveDip - dt * 1.5);
      this.input.consumeJump(); // pas de saut en nage : ignore l'appui

      // Bulles pendant la nage sous l'eau
      if (env?.onBubble && this.speed > 0.5 && this.position.y < waterLevel - 1.0) {
        this.bubbleTimer -= dt;
        if (this.bubbleTimer <= 0) {
          this.bubbleTimer = 0.16;
          env.onBubble(this.position.x, this.position.y + 0.75, this.position.z);
        }
      }
    } else if (this.gliding) {
      // Planage : descente lente (+ courants ascendants) ; Espace replie les ailes
      this.grounded = false;
      if (this.input.consumeJump()) this.stopGlide();
      this.verticalVelocity = THREE.MathUtils.damp(
        this.verticalVelocity,
        -GLIDE_FALL + this.glideLift,
        3.2,
        dt,
      );
      this.position.y += this.verticalVelocity * dt;
      this.stamina = Math.max(0, this.stamina - GLIDE_DRAIN * dt);
      if (this.stamina <= 0) this.stopGlide();
      if (this.position.y <= ground) {
        this.position.y = ground;
        this.verticalVelocity = 0;
        this.grounded = true;
        this.stopGlide();
      }
    } else {
      if (this.grounded && !locked && this.input.consumeJump()) {
        this.verticalVelocity = JUMP_VELOCITY;
        this.grounded = false;
      } else if (!this.grounded && this.glideUnlocked && !locked && this.input.consumeJump()) {
        this.startGlide(); // déploiement en l'air
      }
      this.verticalVelocity -= GRAVITY * dt;
      this.position.y += this.verticalVelocity * dt;

      if (this.position.y <= ground) {
        // Sol quantifié (marches d'escalier ~0,4 m) : grimpe lissée au lieu
        // d'un téléport vertical ; terrain lisse → la montée nécessaire est
        // inférieure au pas de grimpe, donc ancrage exact comme avant.
        const rise = ground - this.position.y;
        this.position.y =
          this.grounded && this.verticalVelocity <= 0 && rise > STEP_UP_SPEED * dt
            ? this.position.y + STEP_UP_SPEED * dt
            : ground;
        this.verticalVelocity = 0;
        this.grounded = true;
      } else if (
        this.grounded &&
        this.verticalVelocity <= 0 &&
        this.position.y - ground < SNAP_DOWN_DISTANCE
      ) {
        // Descente de marches : coller au sol au lieu de chuter par à-coups
        this.position.y = ground;
        this.verticalVelocity = 0;
      }
    }

    // Point de sécurité (rive) + noyade si épuisé en eau profonde
    if (!swimming && this.grounded && waterLevel !== undefined && waterLevel - ground < 0.35) {
      this.lastSafeX = this.position.x;
      this.lastSafeZ = this.position.z;
    }
    if (swimming && this.stamina <= 0) {
      this.position.set(this.lastSafeX, groundAt(this.lastSafeX, this.lastSafeZ), this.lastSafeZ);
      this.stamina = 70;
      this.isSwimming = false;
      this.speed = 0;
    }

    this.object.position.copy(this.position);
    if (this.gliding) this.updateWings();

    if (this.anim) {
      if (!this.animOverride) {
        this.anim.setState(
          this.gliding
            ? 'glide'
            : swimming
              ? this.speed > 0.4
                ? 'swim'
                : 'swimIdle'
              : !this.grounded
                ? 'air'
              : this.speed > 5.4
                ? 'run'
                : this.speed > 0.4
                  ? 'walk'
                  : this.preferredIdle,
        );
      }
      this.anim.update(dt);
    }
  }
}
