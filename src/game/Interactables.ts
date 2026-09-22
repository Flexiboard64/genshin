import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Hud } from '../ui/Hud';

export interface Interactable {
  id: string;
  /** Position fixe ou dynamique (PNJ, esprit). */
  position: THREE.Vector3 | (() => THREE.Vector3);
  /** Distance d'activation. */
  radius: number;
  /** Texte du prompt ; retourner null pour masquer sans désactiver. */
  prompt: () => string | null;
  action: () => void;
}

/**
 * Registre générique d'interactions « F — … » : chaque frame, le prompt de
 * l'interactable actif le plus proche est affiché ; consumeInteract déclenche
 * son action. (Portal garde sa propre logique historique.)
 */
export class Interactables {
  private readonly list: Interactable[] = [];
  private active: Interactable | null = null;
  private readonly tmp = new THREE.Vector3();

  add(item: Interactable): void {
    this.list.push(item);
  }

  remove(id: string): void {
    const i = this.list.findIndex((item) => item.id === id);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Gèle les prompts pendant un dialogue/cinématique. */
  locked = false;

  update(playerPos: THREE.Vector3, hud: Hud, input: Input): void {
    if (this.locked) {
      if (this.active) hud.setInteractPrompt(null);
      this.active = null;
      return;
    }
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const item of this.list) {
      const p = typeof item.position === 'function' ? item.position() : item.position;
      const d = this.tmp.copy(p).sub(playerPos).length();
      if (d <= item.radius && d < bestD && item.prompt() !== null) {
        best = item;
        bestD = d;
      }
    }
    if (best !== this.active) {
      this.active = best;
      hud.setInteractPrompt(best ? best.prompt() : null);
    } else if (best) {
      // Rafraîchit le texte (compteurs dynamiques)
      hud.setInteractPrompt(best.prompt());
    }
    if (best && input.consumeInteract()) {
      const action = best.action;
      hud.setInteractPrompt(null);
      action();
    }
  }
}
