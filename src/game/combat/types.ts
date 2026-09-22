import type { Particles } from '../../fx/Particles';
import type { GroundDecals } from '../../fx/GroundDecals';
import type { LightPulses } from '../../fx/LightPulses';
import type { CameraShake } from '../../fx/CameraShake';

export type DamageKind = 'physical' | 'pyro' | 'playerHurt' | 'heal';

/** Façade FX + feedback passée au combat (joueur et ennemis). */
export interface CombatFx {
  readonly particles: Particles;
  readonly decals: GroundDecals;
  readonly lights: LightPulses;
  readonly shake: CameraShake;
  hitstop(duration: number, scale?: number): void;
  damageNumber(
    x: number,
    y: number,
    z: number,
    amount: number,
    kind: DamageKind,
    crit?: boolean,
  ): void;
}
