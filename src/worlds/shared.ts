import * as THREE from 'three';
import type { Assets } from '../core/Assets';

/** Texture 1×1 de secours si un asset manque (chargement tolérant aux échecs). */
export function fallbackTexture(hex: number): THREE.Texture {
  const color = new THREE.Color(hex);
  const data = new Uint8Array([color.r * 255, color.g * 255, color.b * 255, 255]);
  const texture = new THREE.DataTexture(data, 1, 1);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function texOr(assets: Assets, key: string, fallbackHex: number): THREE.Texture {
  return assets.has(key) ? assets.texture(key) : fallbackTexture(fallbackHex);
}

/** Récupère les clips d'une table [clé manifest → nom canonique] et les renomme. */
export function collectClips(
  assets: Assets,
  table: readonly (readonly [string, string])[],
): THREE.AnimationClip[] {
  const out: THREE.AnimationClip[] = [];
  for (const [key, name] of table) {
    const clip = assets.model(key)?.animations[0];
    if (!clip) continue;
    clip.name = name;
    out.push(clip);
  }
  return out;
}

/** Clone un clip sous un nouveau nom (ex. Run dérivé de Walk). */
export function cloneAs(
  clip: THREE.AnimationClip | undefined,
  name: string,
): THREE.AnimationClip | null {
  if (!clip) return null;
  const c = clip.clone();
  c.name = name;
  return c;
}
