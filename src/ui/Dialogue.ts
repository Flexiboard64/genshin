import type { Vector3 } from 'three';
import type { AudioEngine } from '../core/AudioEngine';

export interface DialogueLine {
  speaker: string;
  text: string;
  /** Clé audio TTS optionnelle (bus voice). */
  voice?: string;
}

export interface DialogueOptions {
  /** Appelé quand la dernière réplique est passée (dialogue refermé). */
  onEnd?: () => void;
  /** Blips voix procéduraux si pas de TTS. */
  audio?: AudioEngine | null;
  /** Tête de l'interlocuteur (monde) — plan cinématique de la DialogueCamera. */
  focus?: Vector3;
}

const CSS = `
#hud.dialogue-open > *:not(#dialogue-box) {
  opacity: 0 !important;
  pointer-events: none !important;
  transition: opacity 0.3s ease;
}
#dialogue-box {
  position: absolute; inset: 0; z-index: 40; pointer-events: auto; cursor: pointer;
  font-family: 'Segoe UI', system-ui, sans-serif;
  user-select: none; -webkit-user-select: none;
  animation: dlg-fade 0.24s ease-out;
}
@keyframes dlg-fade { from { opacity: 0; } to { opacity: 1; } }
#dialogue-box .dlg-gradient {
  position: absolute; left: 0; right: 0; bottom: 0; height: 38%;
  background: linear-gradient(180deg, rgba(4,8,16,0) 0%, rgba(4,8,16,0.58) 46%, rgba(2,5,12,0.92) 100%);
}
#dialogue-box .dlg-topfade {
  position: absolute; left: 0; right: 0; top: 0; height: 11%;
  background: linear-gradient(0deg, rgba(4,8,16,0) 0%, rgba(4,8,16,0.42) 100%);
}
#dialogue-box .dlg-auto {
  position: absolute; left: 26px; top: 22px;
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 15px; border-radius: 999px;
  border: 1px solid rgba(235,242,255,0.22);
  background: rgba(8,12,22,0.44); backdrop-filter: blur(3px);
  color: rgba(238,243,255,0.88); font-size: 13.5px; letter-spacing: 0.05em;
  cursor: pointer; text-shadow: 0 1px 3px rgba(0,0,0,0.7);
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}
#dialogue-box .dlg-auto:hover { background: rgba(22,28,44,0.62); }
#dialogue-box .dlg-auto.on {
  color: #ffd98a; border-color: rgba(255,217,138,0.6);
  background: rgba(48,38,18,0.55);
}
#dialogue-box .dlg-auto .dlg-auto-ico { font-size: 10px; }
#dialogue-box .dlg-body {
  position: absolute; left: 50%; bottom: 8.5%; transform: translateX(-50%);
  width: min(1020px, 86vw);
  animation: dlg-in 0.3s ease-out;
}
@keyframes dlg-in { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
#dialogue-box .dlg-name {
  font-size: 22px; font-weight: 700; color: #ffd98a; letter-spacing: 0.045em;
  text-shadow: 0 1px 6px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.8);
  margin-bottom: 9px;
}
#dialogue-box .dlg-text {
  font-size: 20px; line-height: 1.55; color: #f5f8ff; min-height: 62px;
  text-shadow:
    0 1px 5px rgba(0,0,0,0.95),
    1px 0 2px rgba(0,0,0,0.75), -1px 0 2px rgba(0,0,0,0.75),
    0 -1px 2px rgba(0,0,0,0.75);
  white-space: pre-wrap;
}
#dialogue-box .dlg-next {
  position: absolute; right: 2px; bottom: -29px;
  color: #ffd98a; font-size: 11px; text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  animation: dlg-bob 1.1s ease-in-out infinite; visibility: hidden;
}
@keyframes dlg-bob { 0%, 100% { transform: translateY(0) scale(0.9); opacity: 0.7; } 50% { transform: translateY(4px) scale(1.05); opacity: 1; } }
#dialogue-box .dlg-hint {
  position: absolute; right: 26px; bottom: 16px;
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; letter-spacing: 0.04em; color: rgba(214,226,250,0.72);
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
}
#dialogue-box .dlg-key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 21px; padding: 0 7px; border-radius: 5px;
  background: rgba(240,244,255,0.92); color: #1b2333;
  font-weight: 700; font-size: 11.5px; letter-spacing: 0.02em;
  box-shadow: 0 1px 4px rgba(0,0,0,0.45);
}
`;

/**
 * Dialogue façon Genshin officiel : HUD masqué, bande basse en dégradé, nom
 * doré, texte en machine à écrire, losange ◆ doré quand la ligne est prête,
 * bouton « Auto » (avance tout seul, persistant entre dialogues), curseur
 * libéré (pointer lock quitté à l'ouverture pour cliquer les boutons UI).
 * Espace/E/clic = finir la frappe OU passer à la suite ; la dernière réplique
 * referme et déclenche onEnd. Linéaire par design. Le plan cinématique est
 * assuré par game/DialogueCamera via l'option focus + onOpenChange.
 */
export class Dialogue {
  /** Appelé à chaque avancement du dialogue (SFX blip). */
  onAdvance: (() => void) | null = null;
  /** Appelé à l'ouverture/fermeture — câblé sur Input.uiCapture + caméra dans boot. */
  onOpenChange: ((open: boolean) => void) | null = null;
  private root: HTMLDivElement | null = null;
  private textEl: HTMLDivElement | null = null;
  private nextEl: HTMLDivElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  private nameEl: HTMLDivElement | null = null;
  private autoBtn: HTMLButtonElement | null = null;
  private lines: DialogueLine[] = [];
  private lineIndex = 0;
  private charIndex = 0;
  private typing = false;
  private typeTimer: number | null = null;
  private autoTimer: number | null = null;
  private autoMode = false;
  private opts: DialogueOptions = {};
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private mouseHandler: ((e: MouseEvent) => void) | null = null;

  get isOpen(): boolean {
    return this.root !== null;
  }

  /** Point focal courant (tête de l'interlocuteur) pour la caméra cinématique. */
  get focusPoint(): Vector3 | null {
    return this.opts.focus ?? null;
  }

  show(lines: DialogueLine[], opts: DialogueOptions = {}): void {
    injectDialogueStyle();
    this.hide();
    this.lines = lines;
    this.opts = opts;
    this.lineIndex = 0;

    this.root = document.createElement('div');
    this.root.id = 'dialogue-box';
    this.root.innerHTML = `
      <div class="dlg-gradient"></div>
      <div class="dlg-topfade"></div>
      <button class="dlg-auto" type="button"><span class="dlg-auto-ico">▶</span><span>Auto</span></button>
      <div class="dlg-body">
        <div class="dlg-name"></div>
        <div class="dlg-text"></div>
        <div class="dlg-next">◆</div>
      </div>
      <div class="dlg-hint"><span class="dlg-key">Espace</span><span class="dlg-hint-label">continuer</span></div>`;
    document.getElementById('hud')?.appendChild(this.root);
    document.getElementById('hud')?.classList.add('dialogue-open');
    this.textEl = this.root.querySelector('.dlg-text');
    this.nextEl = this.root.querySelector('.dlg-next');
    this.hintEl = this.root.querySelector('.dlg-hint-label');
    this.nameEl = this.root.querySelector('.dlg-name');
    this.autoBtn = this.root.querySelector('.dlg-auto');
    this.refreshAutoBtn();
    this.autoBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setAuto(!this.autoMode);
    });
    this.onOpenChange?.(true);
    // Le curseur doit pouvoir cliquer « Auto » : le pointer lock est relâché
    // pendant le dialogue (un clic sur le canvas le réengagera ensuite).
    if (document.pointerLockElement) document.exitPointerLock();

    // window mousedown (pas root click) : fonctionne aussi si le pointer lock
    // est encore actif (les événements souris bouillonnent depuis le canvas).
    this.mouseHandler = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (e.target instanceof Element && e.target.closest('.dlg-auto')) return;
      this.advance();
    };
    window.addEventListener('mousedown', this.mouseHandler);
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.advance();
      } else if (e.code === 'Escape') {
        this.skipLine();
      }
    };
    window.addEventListener('keydown', this.keyHandler);

    this.showLine();
  }

  private setAuto(on: boolean): void {
    this.autoMode = on;
    this.refreshAutoBtn();
    if (this.autoTimer !== null) {
      window.clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    if (on && !this.typing && this.isOpen) this.scheduleAutoAdvance();
  }

  private refreshAutoBtn(): void {
    this.autoBtn?.classList.toggle('on', this.autoMode);
  }

  /** Mode Auto : la ligne terminée s'efface seule après un délai ∝ longueur. */
  private scheduleAutoAdvance(): void {
    const line = this.lines[this.lineIndex];
    if (!line) return;
    const delay = Math.min(4600, 850 + line.text.length * 42);
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = null;
      this.advance();
    }, delay);
  }

  private showLine(): void {
    const line = this.lines[this.lineIndex];
    if (!line) return;
    if (this.autoTimer !== null) {
      window.clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    if (this.nameEl) this.nameEl.textContent = line.speaker;
    this.charIndex = 0;
    this.typing = true;
    if (this.textEl) this.textEl.textContent = '';
    if (this.nextEl) this.nextEl.style.visibility = 'hidden';
    this.opts.audio?.duck(0.45);
    if (line.voice && this.opts.audio) {
      void this.opts.audio.play(line.voice, { bus: 'voice' });
    }
    this.typeNextChar();
  }

  private typeNextChar(): void {
    const line = this.lines[this.lineIndex];
    if (!line || !this.textEl) return;
    if (this.charIndex >= line.text.length) {
      this.finishLine();
      return;
    }
    this.textEl.textContent = line.text.slice(0, ++this.charIndex);
    const ch = line.text[this.charIndex - 1];
    const delay = ch === ',' ? 110 : ch === '.' || ch === '…' || ch === '!' || ch === '?' ? 165 : 18;
    this.typeTimer = window.setTimeout(() => this.typeNextChar(), delay);
  }

  private finishLine(): void {
    this.typing = false;
    if (this.nextEl) this.nextEl.style.visibility = 'visible';
    if (this.hintEl) {
      const isLast = this.lineIndex === this.lines.length - 1;
      this.hintEl.textContent = isLast ? 'fermer' : 'continuer';
    }
    if (this.autoMode) this.scheduleAutoAdvance();
  }

  /** Clic/touche : termine la frappe en cours, sinon ligne suivante / fermeture. */
  private advance(): void {
    this.onAdvance?.();
    if (this.autoTimer !== null) {
      window.clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    if (this.typing) {
      this.skipLine();
      return;
    }
    this.lineIndex++;
    if (this.lineIndex >= this.lines.length) {
      const onEnd = this.opts.onEnd;
      this.hide();
      onEnd?.();
    } else {
      this.showLine();
    }
  }

  private skipLine(): void {
    if (this.typeTimer !== null) window.clearTimeout(this.typeTimer);
    const line = this.lines[this.lineIndex];
    if (this.textEl && line) this.textEl.textContent = line.text;
    this.finishLine();
  }

  hide(): void {
    const wasOpen = this.root !== null;
    if (this.typeTimer !== null) window.clearTimeout(this.typeTimer);
    if (this.autoTimer !== null) window.clearTimeout(this.autoTimer);
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    if (this.mouseHandler) window.removeEventListener('mousedown', this.mouseHandler);
    this.root?.remove();
    this.root = null;
    this.opts.audio?.duck(1);
    if (wasOpen) {
      document.getElementById('hud')?.classList.remove('dialogue-open');
      this.onOpenChange?.(false);
    }
  }
}

let styleInjected = false;
export function injectDialogueStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}
