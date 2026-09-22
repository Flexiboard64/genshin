import type { AudioEngine } from '../core/AudioEngine';
import type { Input } from '../core/Input';
import type { Player } from '../game/Player';
import type { WinterHeart } from '../game/quest/winterHeart';
import type { Dialogue } from './Dialogue';
import type { Hud } from './Hud';

interface CheatMenuDeps {
  winterHeart: WinterHeart;
  input: Input;
  player: Player;
  dialogue: Dialogue;
  hud: Hud;
  audio: AudioEngine | null;
  groundAt: (x: number, z: number) => number;
}

/**
 * Menu de triche (touche M) : liste les étapes de la quête principale, clic =
 * saut direct à l'étape (jumpTo) + téléportation sur sa cible. La touche est
 * écoutée ici (et non via Input) pour pouvoir refermer le menu alors que la
 * capture UI bloque les touches de jeu. Pointer lock relâché à l'ouverture.
 */
export class CheatMenu {
  private root: HTMLDivElement | null = null;
  private open = false;

  constructor(private readonly deps: CheatMenuDeps) {
    injectCheatStyle();
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // e.key (caractère produit) et non e.code : en AZERTY la touche M est à
      // la position QWERTY Semicolon — seul e.key vaut 'm' partout.
      if (e.key.toLowerCase() === 'm') {
        if (this.deps.dialogue.isOpen) return;
        this.toggle();
      } else if (e.code === 'Escape' && this.open) {
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    const d = this.deps;
    this.open = true;
    d.input.uiCapture = true;
    d.player.movementLocked = true;
    document.exitPointerLock();
    void d.audio?.play('sfx-ui-blip', { volume: 0.5 });
    this.render();
  }

  close(): void {
    if (!this.open) return;
    const d = this.deps;
    this.open = false;
    d.input.uiCapture = false;
    d.player.movementLocked = false;
    this.root?.remove();
    this.root = null;
    void d.audio?.play('sfx-ui-blip', { volume: 0.4, pitch: 0.85 });
  }

  /** Saut à l'étape i (démarre la quête si besoin) + téléportation à fondu. */
  private jump(i: number): void {
    const d = this.deps;
    const wh = d.winterHeart;
    const step = wh.stepDefs[i];
    if (!step) return;
    if (!wh.isStarted) wh.debugStart();
    wh.quest.jumpTo(step.id);
    // La cible est résolue APRÈS jumpTo : les cibles dynamiques (wisp) sont
    // réinitialisées par le start() de l'étape.
    const t = typeof step.target === 'function' ? step.target() : step.target;
    this.close();
    if (t) {
      void d.audio?.play('sfx-teleport', { volume: 0.7 });
      d.hud.fadeTeleport(() => {
        d.player.position.set(t.x, d.groundAt(t.x, t.z), t.z);
      });
    }
  }

  private render(): void {
    const d = this.deps;
    const wh = d.winterHeart;
    const q = wh.quest;
    this.root?.remove();

    const root = document.createElement('div');
    root.className = 'cheat-overlay';
    const panel = document.createElement('div');
    panel.className = 'cheat-panel';
    root.appendChild(panel);

    const title = document.createElement('div');
    title.className = 'cheat-title';
    title.textContent = 'Menu de triche';
    panel.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'cheat-sub';
    sub.textContent = 'Le Cœur de l’Hiver — clic = aller à l’étape (téléportation) · M / Échap pour fermer';
    panel.appendChild(sub);

    const list = document.createElement('div');
    list.className = 'cheat-list';
    panel.appendChild(list);

    const started = wh.isStarted;
    const finished = q.isFinished;
    const idx = q.index;

    if (!started) {
      const row = document.createElement('button');
      row.className = 'cheat-row cheat-start';
      row.innerHTML = '<span class="cheat-ico">⚑</span><span class="cheat-label">Démarrer la quête (sans l’intro)</span>';
      row.addEventListener('click', () => {
        wh.debugStart();
        this.render();
      });
      list.appendChild(row);
    }

    wh.stepDefs.forEach((step, i) => {
      const state = finished ? 'done' : !started ? 'todo' : i < idx ? 'done' : i === idx ? 'current' : 'todo';
      const row = document.createElement('button');
      row.className = `cheat-row cheat-${state}`;
      const ico = state === 'done' ? '✓' : state === 'current' ? '◆' : '○';
      row.innerHTML = `<span class="cheat-ico">${ico}</span><span class="cheat-label">${i + 1}. ${step.title}</span>`;
      if (finished) row.disabled = true;
      else row.addEventListener('click', () => this.jump(i));
      list.appendChild(row);
    });

    if (finished) {
      const note = document.createElement('div');
      note.className = 'cheat-note';
      note.textContent = 'Quête terminée — l’aurore est restaurée.';
      panel.appendChild(note);
    }

    document.body.appendChild(root);
    this.root = root;
  }
}

let cheatStyleInjected = false;
function injectCheatStyle(): void {
  if (cheatStyleInjected) return;
  cheatStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.cheat-overlay{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgba(3,6,14,.58);backdrop-filter:blur(3px);user-select:none}
.cheat-panel{width:min(480px,92vw);max-height:80vh;overflow:auto;padding:22px 26px 18px;border-radius:10px;background:linear-gradient(160deg,rgba(16,22,40,.96),rgba(8,12,24,.96));border:1px solid rgba(255,215,140,.35);box-shadow:0 18px 60px rgba(0,0,0,.6),inset 0 0 40px rgba(90,140,255,.06);color:#e8ecf4}
.cheat-title{font-size:22px;letter-spacing:.12em;color:#ffd98a;text-align:center;text-shadow:0 0 14px rgba(255,200,110,.35)}
.cheat-sub{margin:6px 0 14px;font-size:12px;text-align:center;color:#9aa7c0}
.cheat-list{display:flex;flex-direction:column;gap:6px}
.cheat-row{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;font-size:15px;font-family:inherit;text-align:left;color:#e8ecf4;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:6px;cursor:pointer;transition:background .15s,border-color .15s,transform .15s}
.cheat-row:hover:not(:disabled){background:rgba(255,217,138,.14);border-color:rgba(255,217,138,.55);transform:translateX(2px)}
.cheat-row:disabled{opacity:.55;cursor:default}
.cheat-ico{width:18px;text-align:center;flex:none}
.cheat-done{color:#9fb4a6}.cheat-done .cheat-ico{color:#8fd6a0}
.cheat-current{border-color:rgba(255,217,138,.6);background:rgba(255,217,138,.10)}
.cheat-current .cheat-ico{color:#ffd98a}
.cheat-todo .cheat-ico{color:#7d8aa5}
.cheat-start{border-style:dashed;border-color:rgba(143,214,160,.5);color:#bfe8cc}
.cheat-note{margin-top:12px;text-align:center;font-size:13px;color:#8fd6a0}
`;
  document.head.appendChild(style);
}
