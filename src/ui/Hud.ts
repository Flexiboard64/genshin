import * as THREE from 'three';
import { terrainHeight, TERRAIN_SIZE } from '../world/Terrain';
import { STAMINA_MAX, type Player } from '../game/Player';
import type { PlayerCombat } from '../game/combat/PlayerCombat';
import type { Enemy } from '../game/combat/Enemy';

const MINIMAP_PX = 190;
const MINIMAP_RADIUS = 45;
const MINIMAP_INTERVAL = 0.3;
const STAMINA_CIRCUMFERENCE = 2 * Math.PI * 30;
const ENEMY_BAR_POOL = 12;
const ENEMY_BAR_RANGE = 45;
const ENEMY_BAR_MEMORY = 6; // s d'affichage après le dernier dégât

interface EnemyBarSlot {
  wrap: HTMLDivElement;
  name: HTMLDivElement;
  fill: HTMLDivElement;
  assigned: Enemy | null;
}

const SVG = {
  exclamation:
    '<path d="M12 5 v9" stroke-width="3.4" stroke-linecap="round"/><circle cx="12" cy="18" r="2" fill="currentColor" stroke="none"/>',
  backpack:
    '<path d="M6.5 9.5 h11 v9.5 a2 2 0 0 1 -2 2 h-7 a2 2 0 0 1 -2 -2 z"/><path d="M9 9.5 V7 a3 3 0 0 1 6 0 v2.5"/><path d="M6.5 13.5 h11"/>',
  hand: '<path d="M8 11.5 V6 a1.4 1.4 0 0 1 2.8 0 v4.5 M10.8 10.5 V4.8 a1.4 1.4 0 0 1 2.8 0 v5.7 M13.6 10.5 V6.4 a1.4 1.4 0 0 1 2.8 0 v6.4 c0 4 -1.8 7.2 -5 7.2 c-2.8 0 -4.4 -1.6 -5.4 -4.6 l-1 -3 a1.4 1.4 0 0 1 2.5 -1 l1.5 2.3"/>',
  person:
    '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 19.5 c0 -4 3 -6.2 6.5 -6.2 s6.5 2.2 6.5 6.2"/>',
  book: '<path d="M12 6.5 C10.5 5 8.5 4.6 5.5 4.6 v13 c3 0 5 .4 6.5 1.9 c1.5 -1.5 3.5 -1.9 6.5 -1.9 v-13 c-3 0 -5 .4 -6.5 1.9 z M12 6.5 v13"/>',
  chat: '<circle cx="7" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="17" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  gadget:
    '<circle cx="10.5" cy="10.5" r="5"/><path d="M14.5 14.5 L19 19"/><circle cx="10.5" cy="10.5" r="1.6" fill="currentColor" stroke="none"/>',
  notice:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5 v6" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1.4" fill="currentColor" stroke="none"/>',
  sparkle:
    '<path d="M12 3.5 L14 10 L20.5 12 L14 14 L12 20.5 L10 14 L3.5 12 L10 10 Z" fill="currentColor" stroke="none"/>',
  aperture:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
};

/** Losanges du suivi de quête, style officiel Genshin. */
const QUEST_ICON_GOLD =
  '<svg viewBox="0 0 24 24"><path d="M12 2.6 L18.6 12 L12 21.4 L5.4 12 Z" fill="#f7c948" stroke="rgba(84,56,10,.8)" stroke-width="1.5"/><path d="M12 6.4 L15.8 12 L12 17.6 L8.2 12 Z" fill="#ffe9a8" opacity="0.85"/></svg>';
const QUEST_ICON_HOLLOW =
  '<svg viewBox="0 0 24 24"><path d="M12 3.6 L18.8 12 L12 20.4 L5.2 12 Z" fill="none" stroke="rgba(255,255,255,.92)" stroke-width="2.1"/></svg>';
const QUEST_ICON_CHECK =
  '<svg viewBox="0 0 24 24"><path d="M12 3.6 L18.8 12 L12 20.4 L5.2 12 Z" fill="#8fd6a0" stroke="rgba(24,66,36,.7)" stroke-width="1.3"/><path d="M8.4 12.3 L11.1 15 L15.8 9.4" stroke="#12341e" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function iconButton(cssClass: string, svg: string, label: string): HTMLDivElement {
  const btn = document.createElement('div');
  btn.className = `icon-btn ${cssClass}`;
  btn.title = label;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
  return btn;
}

interface PartyMember {
  readonly name: string;
  readonly portrait: string;
  readonly elementIcon: string;
  readonly tint: string;
  readonly active: boolean;
}

const PARTY: PartyMember[] = [
  { name: 'Voyageuse', portrait: '/assets/ui/portrait.png', elementIcon: '/assets/ui/element-anemo.png', tint: '#5fbfae', active: true },
  { name: 'Aldric', portrait: '/assets/ui/portrait-2.png', elementIcon: '/assets/ui/element-geo.png', tint: '#c79a4b', active: false },
  { name: 'Naia', portrait: '/assets/ui/portrait-3.png', elementIcon: '/assets/ui/element-hydro.png', tint: '#4f8fd0', active: false },
  { name: 'Shiran', portrait: '/assets/ui/portrait-4.png', elementIcon: '/assets/ui/element-electro.png', tint: '#8f6ac9', active: false },
];

export class Hud {
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly minimapImage: ImageData;
  private mapImage: HTMLCanvasElement | null = null;
  private readonly playerMarker: HTMLDivElement;
  private readonly questMarker: HTMLDivElement;
  private readonly questEl: HTMLDivElement;
  private readonly questTitleEl: HTMLDivElement;
  private readonly questTitleTextEl: HTMLSpanElement;
  private readonly questObjectiveEl: HTMLDivElement;
  private questDistSpans: HTMLSpanElement[] = [];
  private questTarget: { x: number; z: number } | null = null;
  private questAutoComplete = true;
  private questDone = false;
  private readonly regionNameEl: HTMLDivElement;
  private readonly regionSubEl: HTMLDivElement;
  private mapSize = TERRAIN_SIZE;
  private groundAt: (x: number, z: number) => number = terrainHeight;
  private readonly staminaRing: HTMLDivElement;
  private readonly staminaArc: SVGCircleElement;
  private readonly lockHint: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpGhost: HTMLDivElement;
  private readonly hpValue: HTMLSpanElement;
  private readonly partyHpFill: HTMLDivElement;
  private readonly skillEDiv: HTMLDivElement;
  private readonly skillECd: HTMLDivElement;
  private readonly skillECdText: HTMLDivElement;
  private readonly skillQDiv: HTMLDivElement;
  private readonly skillQEnergy: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly deathFade: HTMLDivElement;
  private readonly interactPrompt: HTMLDivElement;
  private readonly interactLabel: HTMLSpanElement;
  private readonly questBanner: HTMLDivElement;
  private readonly qbTitle: HTMLDivElement;
  private readonly qbSub: HTMLDivElement;
  private readonly tpFade: HTMLDivElement;
  private readonly skillGadget: HTMLDivElement;
  private trackerLines: { text: string; done: boolean }[] | null = null;
  private bannerTimer: number | null = null;
  private readonly enemyBars: EnemyBarSlot[] = [];
  private lastHpText = '';
  private mapTimer = 0;
  private lastMapX = Number.POSITIVE_INFINITY;
  private lastMapZ = Number.POSITIVE_INFINITY;
  private readonly projection = new THREE.Vector3();

  constructor() {
    const root = document.getElementById('hud');
    if (!root) throw new Error('[Hud] conteneur #hud introuvable');

    // ——— Haut-gauche : minimap + colonne de boutons ———
    const minimapWrap = document.createElement('div');
    minimapWrap.className = 'minimap-wrap';

    const minimap = document.createElement('div');
    minimap.className = 'minimap';
    const canvas = document.createElement('canvas');
    canvas.width = MINIMAP_PX;
    canvas.height = MINIMAP_PX;
    this.minimapCtx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.minimapImage = this.minimapCtx.createImageData(MINIMAP_PX, MINIMAP_PX);
    minimap.appendChild(canvas);

    this.playerMarker = document.createElement('div');
    this.playerMarker.className = 'minimap-player';
    minimap.appendChild(this.playerMarker);

    this.questMarker = document.createElement('div');
    this.questMarker.className = 'minimap-quest';
    this.questMarker.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M12 3 L17 12 L12 21 L7 12 Z" fill="#f5c243" stroke="rgba(60,42,6,.65)" stroke-width="1.2"/></svg>';
    minimap.appendChild(this.questMarker);
    minimapWrap.appendChild(minimap);

    // ——— Suivi de mission (sous la minimap) ———
    const quest = document.createElement('div');
    quest.className = 'quest';
    quest.innerHTML = `
      <div class="quest-title"><span class="quest-title-icon">${QUEST_ICON_GOLD}</span><span class="quest-title-text"></span></div>
      <div class="quest-objective"></div>`;
    this.questEl = quest;
    this.questTitleEl = quest.querySelector('.quest-title') as HTMLDivElement;
    this.questTitleTextEl = quest.querySelector('.quest-title-text') as HTMLSpanElement;
    this.questObjectiveEl = quest.querySelector('.quest-objective') as HTMLDivElement;
    minimapWrap.appendChild(quest);
    root.appendChild(minimapWrap);

    // ——— Haut-centre : titre de région ———
    const region = document.createElement('div');
    region.className = 'region-title';
    region.innerHTML = `
      <div class="region-name">Plaine de Mondstadt</div>
      <div class="region-sub">Au-dessus du niveau de la mer</div>`;
    this.regionNameEl = region.querySelector('.region-name') as HTMLDivElement;
    this.regionSubEl = region.querySelector('.region-sub') as HTMLDivElement;
    root.appendChild(region);

    // ——— Haut-droite : rangée d'icônes blanches ———
    const topIcons = document.createElement('div');
    topIcons.className = 'top-icons';
    for (const [glyph, label] of [
      [SVG.hand, 'Interactions'],
      [SVG.notice, 'Annonces'],
      [SVG.book, 'Compendium'],
      [SVG.sparkle, 'Événements'],
      [SVG.aperture, 'Galerie'],
    ] as const) {
      const icon = document.createElement('div');
      icon.className = 'top-icon';
      icon.title = label;
      icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;
      topIcons.appendChild(icon);
    }
    root.appendChild(topIcons);

    // ——— Droite : équipe ———
    const party = document.createElement('div');
    party.className = 'party';
    PARTY.forEach((member, index) => {
      const slot = document.createElement('div');
      slot.className = `party-slot${member.active ? ' party-active' : ''}`;
      slot.innerHTML = `
        <div class="party-portrait" style="color:${member.tint};background:${member.tint}">
          <img src="${member.portrait}" alt="${member.name}" />
          <span class="party-element"><img src="${member.elementIcon}" alt="" /></span>
          <span class="party-key">${index + 1}</span>
        </div>
        <div class="party-hp"><div class="party-hp-fill"></div></div>`;
      party.appendChild(slot);
    });
    root.appendChild(party);

    // ——— Bas-centre : barre HP ———
    const hp = document.createElement('div');
    hp.className = 'hp-bar';
    hp.innerHTML = `
      <span class="hp-level">Nv. 1</span>
      <div class="hp-track"><div class="hp-ghost"></div><div class="hp-fill"></div></div>
      <span class="hp-value">10 000/10 000</span>`;
    root.appendChild(hp);
    this.hpFill = hp.querySelector('.hp-fill') as HTMLDivElement;
    this.hpGhost = hp.querySelector('.hp-ghost') as HTMLDivElement;
    this.hpValue = hp.querySelector('.hp-value') as HTMLSpanElement;
    this.partyHpFill = party.querySelector('.party-active .party-hp-fill') as HTMLDivElement;

    // ——— Bas-droite : compétences en diagonale ———
    const skills = document.createElement('div');
    skills.className = 'skills';
    skills.innerHTML = `
      <div class="skill skill-gadget">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${SVG.gadget}</svg>
      </div>
      <div class="skill skill-e">
        <img src="/assets/ui/skill-e.png" alt="Compétence élémentaire" />
        <div class="skill-cd"></div>
        <div class="skill-cd-text"></div>
        <span class="skill-key">E</span>
      </div>
      <div class="skill skill-q">
        <img src="/assets/ui/skill-q.png" alt="Déchaînement élémentaire" />
        <div class="skill-energy"></div>
        <span class="skill-key">R</span>
      </div>`;
    root.appendChild(skills);
    this.skillEDiv = skills.querySelector('.skill-e') as HTMLDivElement;
    this.skillECd = skills.querySelector('.skill-e .skill-cd') as HTMLDivElement;
    this.skillECdText = skills.querySelector('.skill-e .skill-cd-text') as HTMLDivElement;
    this.skillQDiv = skills.querySelector('.skill-q') as HTMLDivElement;
    this.skillQEnergy = skills.querySelector('.skill-q .skill-energy') as HTMLDivElement;

    // ——— Combat : vignette de dégât + fondu de mort ———
    this.vignette = document.createElement('div');
    this.vignette.className = 'dmg-vignette';
    root.appendChild(this.vignette);

    this.deathFade = document.createElement('div');
    this.deathFade.className = 'death-fade';
    root.appendChild(this.deathFade);

    // ——— Barres HP ennemies (pool) ———
    const barsLayer = document.createElement('div');
    barsLayer.className = 'enemy-bars';
    for (let i = 0; i < ENEMY_BAR_POOL; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'enemy-bar';
      wrap.style.display = 'none';
      wrap.innerHTML = `
        <div class="enemy-bar-name"></div>
        <div class="enemy-bar-track"><div class="enemy-bar-fill"></div></div>`;
      barsLayer.appendChild(wrap);
      this.enemyBars.push({
        wrap,
        name: wrap.querySelector('.enemy-bar-name') as HTMLDivElement,
        fill: wrap.querySelector('.enemy-bar-fill') as HTMLDivElement,
        assigned: null,
      });
    }
    root.appendChild(barsLayer);

    // ——— Bas-gauche : chat ———
    const chat = iconButton('chat-btn', SVG.chat, 'Chat');
    root.appendChild(chat);

    this.staminaRing = document.createElement('div');
    this.staminaRing.className = 'stamina-ring';
    this.staminaRing.innerHTML = `
      <svg viewBox="0 0 76 76">
        <circle class="stamina-bg" cx="38" cy="38" r="30" />
        <circle class="stamina-arc" cx="38" cy="38" r="30" />
      </svg>`;
    this.staminaArc = this.staminaRing.querySelector('.stamina-arc') as SVGCircleElement;
    this.staminaArc.style.strokeDasharray = `${STAMINA_CIRCUMFERENCE}`;
    root.appendChild(this.staminaRing);

    this.lockHint = document.createElement('div');
    this.lockHint.className = 'lock-hint';
    this.lockHint.textContent = 'Cliquez pour prendre le contrôle de la caméra';
    root.appendChild(this.lockHint);

    // ——— Prompt d'interaction contextuelle (portails…) ———
    this.interactPrompt = document.createElement('div');
    this.interactPrompt.className = 'interact-prompt hidden';
    this.interactPrompt.innerHTML = `<span class="interact-key">F</span><span class="interact-label"></span>`;
    this.interactLabel = this.interactPrompt.querySelector('.interact-label') as HTMLSpanElement;
    root.appendChild(this.interactPrompt);

    // ——— Bannière dorée de quête ———
    this.questBanner = document.createElement('div');
    this.questBanner.className = 'quest-banner';
    this.questBanner.innerHTML = `
      <div class="qb-title"></div>
      <div class="qb-sub"></div>
      <div class="qb-rule"></div>`;
    this.qbTitle = this.questBanner.querySelector('.qb-title') as HTMLDivElement;
    this.qbSub = this.questBanner.querySelector('.qb-sub') as HTMLDivElement;
    root.appendChild(this.questBanner);

    // ——— Fondu de téléportation ———
    this.tpFade = document.createElement('div');
    this.tpFade.className = 'tp-fade';
    root.appendChild(this.tpFade);

    this.skillGadget = skills.querySelector('.skill-gadget') as HTMLDivElement;
  }

  setPointerLocked(locked: boolean): void {
    this.lockHint.classList.toggle('hidden', locked);
  }

  /** Affiche/masque le prompt d'interaction (« F — … ») ; null pour cacher. */
  setInteractPrompt(label: string | null): void {
    if (label) {
      this.interactLabel.textContent = label;
      this.interactPrompt.classList.remove('hidden');
    } else {
      this.interactPrompt.classList.add('hidden');
    }
  }

  /** Image top-down du monde (capture GPU) utilisée par la minimap. */
  setMapImage(canvas: HTMLCanvasElement, size = TERRAIN_SIZE): void {
    this.mapImage = canvas;
    this.mapSize = size;
    this.lastMapX = Number.POSITIVE_INFINITY; // force un redraw
  }

  /** Titre de région affiché haut-centre (ex. « Snezhnaya — Plateau de Zapolyarny »). */
  setRegion(name: string, sub: string): void {
    this.regionNameEl.textContent = name;
    this.regionSubEl.textContent = sub;
  }

  /** Hauteur de terrain pour la minimap de secours (monde courant). */
  setGroundAt(fn: (x: number, z: number) => number): void {
    this.groundAt = fn;
  }

  /**
   * Définit la mission active ; la cible alimente distance temps réel + losange
   * sur la minimap. `autoComplete: false` = pas de bascule « Terminée » à
   * l'arrivée (objectifs d'intro dont la suite est déclenchée par une action).
   */
  setQuest(title: string, objective: string, target?: { x: number; z: number }, autoComplete = true): void {
    this.trackerLines = null;
    this.questTarget = target ?? null;
    this.questAutoComplete = autoComplete;
    this.questDone = false;
    this.questTitleTextEl.textContent = title;
    this.questTitleEl.classList.remove('quest-done');
    this.questObjectiveEl.innerHTML =
      `<div class="qline"><span class="qline-icon">${QUEST_ICON_HOLLOW}</span>` +
      `<span class="qline-text"></span><span class="qline-dist"></span></div>`;
    (this.questObjectiveEl.querySelector('.qline-text') as HTMLSpanElement).textContent = objective;
    this.questDistSpans = [this.questObjectiveEl.querySelector('.qline-dist') as HTMLSpanElement];
    this.questMarker.style.opacity = target ? '1' : '0';
    this.replayQuestAnim();
  }

  /** Tracker de quête multi-lignes (système de quête v0.5). */
  setQuestTracker(title: string, lines: { text: string; done: boolean }[], target: { x: number; z: number } | null): void {
    this.trackerLines = lines;
    this.questTarget = target;
    this.questDone = false;
    this.questTitleTextEl.textContent = title;
    this.questTitleEl.classList.remove('quest-done');
    this.questObjectiveEl.innerHTML = lines
      .map(
        (line) =>
          `<div class="qline${line.done ? ' qline-done' : ''}"><span class="qline-icon">${line.done ? QUEST_ICON_CHECK : QUEST_ICON_HOLLOW}</span>` +
          `<span class="qline-text">${line.text}</span><span class="qline-dist"></span></div>`,
      )
      .join('');
    this.questDistSpans = Array.from(this.questObjectiveEl.querySelectorAll('.qline-dist'));
    this.questMarker.style.opacity = target ? '1' : '0';
    this.replayQuestAnim();
  }

  /** Masque complètement le suivi de quête. */
  clearQuest(): void {
    this.trackerLines = null;
    this.questTarget = null;
    this.questDistSpans = [];
    this.questTitleTextEl.textContent = '';
    this.questObjectiveEl.textContent = '';
    this.questMarker.style.opacity = '0';
  }

  /** Rejoue l'animation d'arrivée du tracker (appels événementiels uniquement). */
  private replayQuestAnim(): void {
    this.questEl.classList.remove('quest-refresh');
    void this.questEl.offsetWidth;
    this.questEl.classList.add('quest-refresh');
  }

  /** Bannière dorée centrée (quête acceptée/terminée, événement). */
  banner(title: string, subtitle: string, color = '#ffd98a', duration = 2.6): void {
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.qbTitle.textContent = title;
    this.qbTitle.style.color = color;
    this.qbSub.textContent = subtitle;
    this.questBanner.classList.add('show');
    this.bannerTimer = window.setTimeout(() => {
      this.questBanner.classList.remove('show');
      this.bannerTimer = null;
    }, duration * 1000);
  }

  /** Mode intérieur : masque minimap et titre de région. */
  setIndoor(indoor: boolean): void {
    document.getElementById('hud')?.classList.toggle('indoor', indoor);
  }

  /** Affiche l'icône de planeur dans le slot gadget (déblocage). */
  setGliderUnlocked(unlocked: boolean): void {
    if (unlocked) {
      this.skillGadget.innerHTML = '<img class="glider-img" src="/assets/ui/glider-icon.png" alt="Planeur du vent" />';
      this.skillGadget.title = 'Planeur du vent — Espace en l\'air';
    }
  }

  /** Fondu noir → action (téléport) → réouverture. */
  fadeTeleport(action: () => void): void {
    this.tpFade.style.opacity = '1';
    window.setTimeout(() => {
      action();
      window.setTimeout(() => {
        this.tpFade.style.opacity = '0';
      }, 240);
    }, 380);
  }

  /** Distance restante + bascule « terminée » ; positionne le losange sur la cible. */
  private updateQuest(playerX: number, playerZ: number): void {
    if (!this.questTarget) return;
    const dx = this.questTarget.x - playerX;
    const dz = this.questTarget.z - playerZ;
    const dist = Math.hypot(dx, dz);

    if (!this.questDone) {
      // Sans auto-complétion, la distance s'efface une fois sur place (l'action guide la suite).
      const distText = dist < 4 && !this.questAutoComplete ? '' : ` · ${Math.round(dist)} m`;
      if (this.trackerLines === null) {
        const el = this.questDistSpans[0];
        if (el && el.textContent !== distText) el.textContent = distText;
        if (dist < 4 && this.questAutoComplete) {
          this.questDone = true;
          this.questTitleEl.classList.add('quest-done');
          this.questObjectiveEl.innerHTML =
            `<div class="qline qline-done"><span class="qline-icon">${QUEST_ICON_CHECK}</span>` +
            `<span class="qline-text">Terminée</span></div>`;
          this.questDistSpans = [];
          this.questMarker.style.opacity = '0';
        }
      } else {
        // Distance sur la première ligne non accomplie (compteurs).
        let shown = false;
        for (let i = 0; i < this.questDistSpans.length; i++) {
          const done = this.trackerLines[i]?.done ?? true;
          const txt = !done && !shown ? distText : '';
          if (!done) shown = true;
          const el = this.questDistSpans[i];
          if (el.textContent !== txt) el.textContent = txt;
        }
      }
    }

    if (!this.questDone) {
      const half = MINIMAP_PX / 2;
      let px = half + (dx / (MINIMAP_RADIUS * 2)) * MINIMAP_PX;
      let py = half + (dz / (MINIMAP_RADIUS * 2)) * MINIMAP_PX;
      const offX = px - half;
      const offY = py - half;
      const offDist = Math.hypot(offX, offY);
      const maxR = half - 12;
      if (offDist > maxR) {
        px = half + (offX / offDist) * maxR;
        py = half + (offY / offDist) * maxR;
      }
      this.questMarker.style.left = `${px}px`;
      this.questMarker.style.top = `${py}px`;
    }
  }

  update(dt: number, camera: THREE.Camera, player: Player): void {
    if (this.mapImage) {
      // Blit GPU : quasi gratuit, on suit le joueur à chaque frame.
      this.blitMapRegion(player.position.x, player.position.z);
    } else {
      this.mapTimer -= dt;
      const moved =
        Math.abs(player.position.x - this.lastMapX) > 4 ||
        Math.abs(player.position.z - this.lastMapZ) > 4;
      if (this.mapTimer <= 0 && moved) {
        this.drawProceduralMinimap(player.position.x, player.position.z);
        this.lastMapX = player.position.x;
        this.lastMapZ = player.position.z;
        this.mapTimer = MINIMAP_INTERVAL;
      }
    }

    const heading = player.object.rotation.y;
    const facingFromNorth = Math.atan2(Math.sin(heading), -Math.cos(heading));
    this.playerMarker.style.transform = `translate(-50%, -50%) rotate(${facingFromNorth}rad)`;

    this.updateQuest(player.position.x, player.position.z);

    const showStamina = player.isSprinting || player.stamina < STAMINA_MAX - 0.5;
    this.staminaRing.classList.toggle('visible', showStamina);
    if (showStamina) {
      this.staminaArc.style.strokeDashoffset = String(
        STAMINA_CIRCUMFERENCE * (1 - player.stamina / STAMINA_MAX),
      );
      this.projection
        .set(player.position.x, player.position.y + 1.1, player.position.z)
        .project(camera);
      const sx = (this.projection.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-this.projection.y * 0.5 + 0.5) * window.innerHeight;
      this.staminaRing.style.left = `${sx}px`;
      this.staminaRing.style.top = `${sy}px`;
    }
  }

  /** Flash rouge quand le joueur subit des dégâts. */
  damageFlash(): void {
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth; // redémarre l'animation
    this.vignette.classList.add('flash');
  }

  /** Fondu au noir à la mort du joueur. */
  setDeathFade(show: boolean): void {
    this.deathFade.classList.toggle('visible', show);
  }

  /** HUD de combat : HP joueur, cooldowns E/Q, barres HP ennemies. */
  updateCombat(
    camera: THREE.Camera,
    combat: PlayerCombat,
    enemies: readonly Enemy[],
    elapsed: number,
    swimming: boolean,
  ): void {
    // ——— HP joueur (barre + fantôme blanc + texte) ———
    const ratio = Math.max(0, combat.hp / combat.hpMax);
    this.hpFill.style.width = `${ratio * 100}%`;
    this.hpGhost.style.width = `${ratio * 100}%`;
    this.hpFill.classList.toggle('hp-low', ratio < 0.3);
    this.partyHpFill.style.width = `${ratio * 100}%`;
    const hpText = `${combat.hp.toLocaleString('fr-FR')}/${combat.hpMax.toLocaleString('fr-FR')}`;
    if (hpText !== this.lastHpText) {
      this.lastHpText = hpText;
      this.hpValue.textContent = hpText;
    }

    // ——— Cooldown E (balayage sombre + secondes restantes) ———
    const cdRatio = combat.eCooldownRatio;
    this.skillECd.style.background =
      cdRatio > 0
        ? `conic-gradient(rgba(8, 10, 16, 0.78) ${cdRatio * 360}deg, transparent 0deg)`
        : 'none';
    const cdSeconds = Math.ceil(cdRatio * 6);
    this.skillECdText.textContent = cdRatio > 0 ? String(cdSeconds) : '';

    // ——— Énergie Q (remplissage doré + lueur quand prêt) ———
    const energy = combat.energyRatio;
    const ready = combat.qReady;
    this.skillQEnergy.style.background = ready
      ? 'none'
      : `conic-gradient(rgba(8, 10, 16, 0.72) ${(1 - energy) * 360}deg, transparent 0deg)`;
    this.skillQDiv.classList.toggle('skill-ready', ready && !swimming);
    this.skillEDiv.classList.toggle('skill-disabled', swimming);
    this.skillQDiv.classList.toggle('skill-disabled', swimming);

    // ——— Barres HP ennemies ———
    let slot = 0;
    for (const e of enemies) {
      if (slot >= ENEMY_BAR_POOL) break;
      if (!e.alive) continue;
      const visible = e.aggroed || elapsed - e.lastHurtAt < ENEMY_BAR_MEMORY;
      if (!visible) continue;

      this.projection
        .set(e.position.x, e.position.y + e.config.barHeight, e.position.z)
        .project(camera);
      if (this.projection.z > 1) continue;
      const sx = (this.projection.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-this.projection.y * 0.5 + 0.5) * window.innerHeight;
      if (sx < -60 || sx > window.innerWidth + 60 || sy < -40 || sy > window.innerHeight + 40) continue;
      const dist = Math.hypot(e.position.x - camera.position.x, e.position.z - camera.position.z);
      if (dist > ENEMY_BAR_RANGE) continue;

      const bar = this.enemyBars[slot++];
      if (bar.assigned !== e) {
        bar.assigned = e;
        bar.name.textContent = `${e.config.name} · Nv. ${e.config.level}`;
        bar.wrap.classList.toggle('enemy-bar-boss', e.config.knockbackResist >= 0.9);
      }
      bar.fill.style.width = `${(e.hp / e.config.maxHp) * 100}%`;
      bar.wrap.style.display = 'block';
      bar.wrap.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }
    for (let i = slot; i < ENEMY_BAR_POOL; i++) {
      this.enemyBars[i].wrap.style.display = 'none';
      this.enemyBars[i].assigned = null;
    }
  }

  /** Découpe la zone centrée sur le joueur dans l'image monde (nord en haut, clampé aux bords). */
  private blitMapRegion(centerX: number, centerZ: number): void {
    const source = this.mapImage as HTMLCanvasElement;
    const ctx = this.minimapCtx;
    const resolution = source.width;
    const pxPerMeter = resolution / this.mapSize;
    const srcSize = MINIMAP_RADIUS * 2 * pxPerMeter;
    const sx = (centerX + this.mapSize / 2 - MINIMAP_RADIUS) * pxPerMeter;
    const sy = (centerZ + this.mapSize / 2 - MINIMAP_RADIUS) * pxPerMeter;

    const cx0 = THREE.MathUtils.clamp(sx, 0, resolution);
    const cy0 = THREE.MathUtils.clamp(sy, 0, resolution);
    const cx1 = THREE.MathUtils.clamp(sx + srcSize, 0, resolution);
    const cy1 = THREE.MathUtils.clamp(sy + srcSize, 0, resolution);

    ctx.fillStyle = '#1d3a5f';
    ctx.fillRect(0, 0, MINIMAP_PX, MINIMAP_PX);
    if (cx1 <= cx0 || cy1 <= cy0) return;

    const destScale = MINIMAP_PX / srcSize;
    ctx.drawImage(
      source,
      cx0,
      cy0,
      cx1 - cx0,
      cy1 - cy0,
      (cx0 - sx) * destScale,
      (cy0 - sy) * destScale,
      (cx1 - cx0) * destScale,
      (cy1 - cy0) * destScale,
    );
  }

  /** Secours si la capture GPU est indisponible : dégradé de hauteur procédural. */
  private drawProceduralMinimap(centerX: number, centerZ: number): void {
    const data = this.minimapImage.data;
    const metersPerPx = (MINIMAP_RADIUS * 2) / MINIMAP_PX;

    for (let py = 0; py < MINIMAP_PX; py++) {
      const worldZ = centerZ + (py - MINIMAP_PX / 2) * metersPerPx;
      for (let px = 0; px < MINIMAP_PX; px++) {
        const worldX = centerX + (px - MINIMAP_PX / 2) * metersPerPx;
        const h = this.groundAt(worldX, worldZ);
        const slope = Math.abs(
          this.groundAt(worldX + metersPerPx, worldZ) - h,
        );
        const i = (py * MINIMAP_PX + px) * 4;

        let r: number;
        let g: number;
        let b: number;
        if (slope > 0.55) {
          r = 138; g = 134; b = 126;
        } else {
          const t = THREE.MathUtils.clamp((h + 8) / 20, 0, 1);
          r = 103 + t * 60;
          g = 148 + t * 52;
          b = 74 + t * 38;
        }
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    this.minimapCtx.putImageData(this.minimapImage, 0, 0);
  }
}
