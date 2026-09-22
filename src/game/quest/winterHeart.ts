import * as THREE from 'three';
import type { Hud } from '../../ui/Hud';
import type { Dialogue } from '../../ui/Dialogue';
import type { AudioEngine } from '../../core/AudioEngine';
import type { Player } from '../Player';
import type { EnemyManager } from '../combat/EnemyManager';
import type { Enemy } from '../combat/Enemy';
import type { Interactables } from '../Interactables';
import type { Npc } from '../Npc';
import type { ThroneRoom } from '../../worlds/snezhnaya/ThroneRoom';
import type { VillageBraziers } from './VillageBraziers';
import type { MeltTargets } from './MeltTargets';
import type { WispGuide } from './WispGuide';
import type { Glider } from '../Glider';
import type { PolarSky } from '../../worlds/snezhnaya/PolarSky';
import type { CombatFx } from '../combat/types';
import { QuestSystem, type QuestStepDef } from './QuestSystem';
import { TOWN, FROZEN_LAKE } from '../../worlds/snezhnaya/SnowTerrain';

/** Positions des monolithes scellés dans la Forêt des Murmures. */
export const MONOLITHS = [
  { x: -81, z: -45 },
  { x: -59, z: -67 },
  { x: -89, z: -71 },
] as const;
/** Centre de l'embuscade déclenchée par la fonte de la fontaine. */
export const AMBUSH = { x: -37, z: 73 };
/** Gardien de Givre (île centrale du lac gelé). */
export const BOSS_POS = { x: 44, z: 28 };
/** Éclats de l'Hiver : village, forêt, île. */
export const SHARD_POS = [
  { x: -45, z: 53 },
  { x: -75, z: -55 },
  { x: 40.5, z: 29.5 },
] as const;

const SHARD_LABEL = 'Recueillir l’Éclat de l’Hiver';

/**
 * Éclat de l'Hiver : cristal additif flottant au-dessus d'un piédestal de
 * pierre (modèle optionnel). Visible seulement quand l'étape l'exige.
 */
export class HeartShard {
  readonly object = new THREE.Group();
  readonly position: THREE.Vector3;
  private readonly core: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private shown = false;

  constructor(x: number, y: number, z: number, pedestal: THREE.Object3D | null) {
    this.position = new THREE.Vector3(x, y, z);
    if (pedestal) {
      pedestal.position.set(x, y, z);
      this.object.add(pedestal);
    }
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.75, 0.95, 1.0),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const haloMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.35, 0.7, 1.0),
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), coreMat);
    this.halo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48, 1), haloMat);
    this.core.position.y = 1.35;
    this.halo.position.y = 1.35;
    this.object.add(this.core, this.halo);
    this.object.position.copy(this.position);
    this.setVisible(false);
  }

  get isShown(): boolean {
    return this.shown;
  }

  setVisible(v: boolean): void {
    this.shown = v;
    this.core.visible = v;
    this.halo.visible = v;
  }

  update(dt: number, elapsed: number): void {
    if (!this.shown) return;
    this.core.rotation.y += dt * 1.6;
    this.core.rotation.x += dt * 0.5;
    const bob = Math.sin(elapsed * 2.1 + this.position.x) * 0.09;
    this.core.position.y = 1.35 + bob;
    this.halo.position.y = 1.35 + bob;
    const s = 1 + 0.14 * Math.sin(elapsed * 3.7);
    this.halo.scale.setScalar(s);
  }
}

export interface WinterHeartDeps {
  hud: Hud;
  dialogue: Dialogue;
  audio: AudioEngine | null;
  player: Player;
  playerCombatHpFill: (() => void) | null;
  enemies: EnemyManager;
  interactables: Interactables;
  oracle: Npc | null;
  throneRoom: ThroneRoom;
  braziers: VillageBraziers;
  meltTargets: MeltTargets;
  wisp: WispGuide;
  glider: Glider;
  sky: PolarSky;
  fx: CombatFx;
  groundAt: (x: number, z: number) => number;
  shards: HeartShard[];
}

const ORACLE_NAME = 'Marfoucha, Oracle de la Tsarine';

/**
 * Réplique d'orientation par étape : relancer l'Oracle en cours de quête
 * rappelle l'objectif courant (façon Genshin, le PNJ-guide ne se tait jamais).
 */
const ORACLE_HINTS: Record<string, string> = {
  braseros: 'Les braseros de Beryozka sont éteints. Frappez-les de feu Pyro — le village est au sud-ouest, suivez le chemin.',
  fontaine: 'La fontaine de la place est prisonnière de glace. Faites-la fondre… mais méfiez-vous de ce que la glace réveille.',
  eclat1: 'Le premier Éclat repose sur son piédestal, près de la place du village. Prenez-le.',
  esprit: 'Le renard-esprit vous attend près du village. Suivez sa lumière à travers la brume.',
  monolithes: 'Le renard vous a menée au monolithe scellé, au fond de la Forêt des Murmures. Brisez son sceau de glace par le feu.',
  eclat2: 'Le second Éclat vous attend dans la forêt, là où le renard vous a menée.',
  planage: 'Du piton au-dessus de la gorge, déployez vos ailes — Espace en l’air — et traversez les anneaux jusqu’à l’île.',
  gardien: 'Le Gardien de Givre veille sur l’île du lac gelé. Terrassez-le, et le dernier Éclat sera vôtre.',
  eclat3: 'Le dernier Éclat est libéré, sur l’île du lac. Prenez-le, puis revenez me voir.',
};

/**
 * « Le Cœur de l'Hiver » : grande quête Snezhnaya en 8 étapes. Câble tous
 * les systèmes (braseros, fonte pyro, esprit-guide, sceaux, planage, boss,
 * dialogues Oracle, finale aurore) dans une machine à étapes data-driven.
 */
export class WinterHeart {
  readonly quest: QuestSystem;
  private readonly deps: WinterHeartDeps;
  /** Étapes construites une fois (menu de triche + démarrage). */
  private readonly catalog: QuestStepDef[];
  private started = false;
  private finaleDone = false;
  private readonly collected = [false, false, false];
  // Compteurs permanents (rejoués à l'entrée d'étape si faits en avance)
  private fountainMelted = false;
  private ambushTriggered = false;
  private ambushKills = 0;
  private sealsMelted = 0;
  private sentinelleKills = 0;
  /** Musique de combat (boss) — lu par boot pour AudioEngine.setScene. */
  combatMusic = false;
  /** Musique forcée (finale) — lu par boot pour AudioEngine.setScene. */
  musicOverride: string | null = null;
  private finaleMusicT = 0;

  constructor(deps: WinterHeartDeps) {
    this.deps = deps;
    this.quest = new QuestSystem(deps.hud, () => this.onQuestComplete());
    this.catalog = this.buildSteps();
    this.setupInteractables();
  }

  /** Catalogue des étapes (menu de triche, vérifications). */
  get stepDefs(): readonly QuestStepDef[] {
    return this.catalog;
  }

  /** Triche : démarre la quête en sautant le dialogue d'intro. */
  debugStart(): void {
    if (!this.started) this.acceptQuest();
  }

  /** One-shot positionnel (atténuation/pan gérés par l'AudioEngine). */
  private play3d(key: string, x: number, z: number, volume = 0.9): void {
    void this.deps.audio?.play(key, { at: { x, z }, listener: this.deps.player.position, volume });
  }

  get isStarted(): boolean {
    return this.started;
  }

  get diag(): Record<string, unknown> {
    return {
      ...this.quest.diag,
      started: this.started,
      collected: [...this.collected],
      fountain: this.fountainMelted,
      seals: this.sealsMelted,
    };
  }

  /** Dernier état intérieur/extérieur affiché (évite de rejouer l'anim du tracker). */
  private introInside: boolean | null = null;

  /**
   * Texte d'intro du tracker (avant l'audience) selon la position du joueur.
   * Sans auto-complétion : arriver devant la porte n'affiche PAS « Terminée »,
   * la suite est déclenchée par l'entrée (F) puis le dialogue avec l'Oracle.
   */
  refreshIntroTracker(): void {
    if (this.started) return;
    const inside = this.deps.throneRoom.isInside(this.deps.player.position);
    if (this.introInside === inside) return;
    this.introInside = inside;
    if (inside) {
      const o = this.deps.throneRoom.oraclePos;
      this.deps.hud.setQuest('Le Cœur de l’Hiver', 'S’entretenir avec Marfoucha, l’Oracle', { x: o.x, z: o.z }, false);
    } else {
      this.deps.hud.setQuest('Le Cœur de l’Hiver', 'Entrer dans le palais de la Tsarine', { x: 0, z: -123 }, false);
    }
  }

  // ——— Callbacks des systèmes de jeu ———

  /** Brasero allumé (VillageBraziers.onLit). */
  onBrazierLit(index: number, litCount: number): void {
    const b = this.deps.braziers.braziers[index];
    if (b) this.play3d('sfx-brazier-ignite', b.position.x, b.position.z, 0.9);
    if (litCount === 1) void this.deps.audio?.play('sfx-village-bell', { volume: 0.55 });
    if (this.quest.current?.id === 'braseros') this.quest.setCounter('braseros', litCount);
  }

  /** Cible gelée fondue (MeltTargets.onMelted). */
  onMelted(id: string): void {
    if (id === 'fontaine') {
      this.fountainMelted = true;
      this.play3d('sfx-ice-melt', TOWN.x, TOWN.z, 0.9);
      if (this.quest.current?.id === 'fontaine') this.completeFountainStep();
    } else if (id.startsWith('sceau-')) {
      this.sealsMelted = Math.min(1, this.sealsMelted + 1);
      const i = Number(id.split('-')[1]);
      const m = MONOLITHS[i];
      if (m) {
        const n = this.deps.enemies.activateDormant(m.x, m.z, 8);
        if (n > 0) this.play3d('sfx-ice-crack', m.x, m.z, 0.9);
      }
      if (this.quest.current?.id === 'monolithes') this.quest.setCounter('sceaux', this.sealsMelted);
    }
  }

  /** Ennemi tué (EnemyManager.onEnemyDied) — compteurs d'embuscade/sentinelles/boss. */
  onEnemyDied(e: Enemy): void {
    const near = (x: number, z: number, r: number) => Math.hypot(e.spawn.x - x, e.spawn.z - z) < r;
    if (near(AMBUSH.x, AMBUSH.z, 16)) {
      this.ambushKills = Math.min(3, this.ambushKills + 1);
      if (this.quest.current?.id === 'fontaine') this.quest.setCounter('embuscade', this.ambushKills);
      return;
    }
    if (MONOLITHS.some((m) => near(m.x, m.z, 10))) {
      this.sentinelleKills = Math.min(1, this.sentinelleKills + 1);
      if (this.quest.current?.id === 'monolithes') this.quest.setCounter('sentinelles', this.sentinelleKills);
      return;
    }
    if (e.config.name === 'Gardien de Givre') {
      if (this.quest.current?.id === 'gardien') this.quest.setCounter('gardien', 1);
      this.combatMusic = false;
    }
  }

  /** Anneau de planage franchi (Glider.onRing). */
  onRingPassed(_index: number, count: number): void {
    void this.deps.audio?.play('sfx-ring-ding', { volume: 0.75 });
    if (this.quest.current?.id === 'planage') this.quest.setCounter('anneaux', count);
  }

  private completeFountainStep(): void {
    this.quest.setCounter('fontaine', 1);
    if (!this.ambushTriggered) {
      this.ambushTriggered = true;
      this.deps.enemies.activateDormant(AMBUSH.x, AMBUSH.z, 16);
      this.deps.hud.banner('Embuscade !', 'Les slimes de givre surgissent', '#ff9a8a', 2.2);
      void this.deps.audio?.play('sfx-boss-roar', { volume: 0.4, pitch: 1.4 });
    }
    this.quest.setCounter('embuscade', this.ambushKills);
  }

  // ——— Étapes ———

  private buildSteps(): QuestStepDef[] {
    const d = this.deps;
    return [
      {
        id: 'braseros',
        title: 'Rallumez les braseros de Beryozka',
        hint: 'Frappez les braseros éteints de feu Pyro',
        target: { x: TOWN.x, z: TOWN.z },
        counters: [{ key: 'braseros', label: 'Braseros rallumés', max: 4 }],
        start: () => {
          d.audio?.play('sfx-quest-jingle', { volume: 0.6 });
          if (d.braziers.litCount > 0) this.quest.setCounter('braseros', d.braziers.litCount);
        },
      },
      {
        id: 'fontaine',
        title: 'Délivrez la fontaine de Beryozka',
        hint: 'Faites fondre la glace qui l’emprisonne',
        target: { x: TOWN.x, z: TOWN.z },
        counters: [
          { key: 'fontaine', label: 'Fontaine dégelée', max: 1 },
          { key: 'embuscade', label: 'Embuscade repoussée', max: 3 },
        ],
        start: () => {
          d.audio?.play('sfx-quest-jingle', { volume: 0.6 });
          if (this.fountainMelted) this.completeFountainStep();
        },
      },
      this.shardStep(0, 'eclat1', 'Recueillez l’Éclat de l’Hiver'),
      {
        id: 'esprit',
        title: 'Suivez l’esprit du renard',
        hint: 'Restez proche dans la brume',
        target: () => ({ x: d.wisp.position.x, z: d.wisp.position.z }),
        manualAdvance: true,
        start: () => {
          void d.audio?.play('sfx-quest-jingle', { volume: 0.6 });
          d.wisp.begin();
          const p = d.wisp.position;
          this.play3d('sfx-spirit-chime', p.x, p.z, 0.9);
        },
        isComplete: () => d.wisp.arrived,
      },
      {
        id: 'monolithes',
        title: 'Brisez le sceau du monolithe',
        hint: 'Le Pyro fera fondre la glace maudite',
        target: { x: MONOLITHS[2].x, z: MONOLITHS[2].z },
        counters: [
          { key: 'sceaux', label: 'Sceau fondu', max: 1 },
          { key: 'sentinelles', label: 'Sentinelle vaincue', max: 1 },
        ],
        start: () => {
          d.audio?.play('sfx-quest-jingle', { volume: 0.6 });
          if (this.sealsMelted > 0) this.quest.setCounter('sceaux', this.sealsMelted);
          if (this.sentinelleKills > 0) this.quest.setCounter('sentinelles', this.sentinelleKills);
        },
      },
      this.shardStep(1, 'eclat2', 'Recueillez le second Éclat'),
      {
        id: 'planage',
        title: 'Planez jusqu’à l’île du lac gelé',
        hint: 'Espace en l’air pour déployer les ailes',
        target: { x: FROZEN_LAKE.x, z: FROZEN_LAKE.z },
        counters: [{ key: 'anneaux', label: 'Anneaux traversés', max: 8 }],
        manualAdvance: true,
        start: () => {
          d.audio?.play('sfx-quest-jingle', { volume: 0.6 });
          d.glider.resetRings();
          if (d.glider.passedCount > 0) this.quest.setCounter('anneaux', d.glider.passedCount);
        },
        isComplete: () => {
          const p = d.player.position;
          if (d.player.gliding) return false;
          const nearIsland = Math.hypot(p.x - FROZEN_LAKE.x, p.z - FROZEN_LAKE.z) < 14;
          return nearIsland && Math.abs(p.y - d.groundAt(p.x, p.z)) < 2.5;
        },
      },
      {
        id: 'gardien',
        title: 'Vainquez le Gardien de Givre',
        target: { x: BOSS_POS.x, z: BOSS_POS.z },
        counters: [{ key: 'gardien', label: 'Gardien de Givre', max: 1 }],
        start: () => {
          void d.audio?.play('sfx-quest-jingle', { volume: 0.6 });
          const n = d.enemies.activateDormant(BOSS_POS.x, BOSS_POS.z, 10);
          if (n > 0) {
            void d.audio?.play('sfx-boss-roar', { volume: 0.85 });
            this.combatMusic = true;
          }
        },
      },
      this.shardStep(2, 'eclat3', 'Recueillez le dernier Éclat'),
      {
        id: 'retour',
        title: 'Rapportez les Éclats à Marfoucha',
        hint: 'Le Cœur de l’Hiver attend d’être recomposé',
        target: { x: 0, z: -123 },
        manualAdvance: true,
        start: () => d.audio?.play('sfx-quest-jingle', { volume: 0.6 }),
        isComplete: () => this.finaleDone,
      },
    ];
  }

  private shardStep(index: number, id: string, title: string): QuestStepDef {
    const d = this.deps;
    const pos = SHARD_POS[index];
    return {
      id,
      title,
      target: { x: pos.x, z: pos.z },
      manualAdvance: true,
      start: () => {
        void d.audio?.play('sfx-quest-jingle', { volume: 0.6 });
        d.shards[index].setVisible(true);
        this.play3d('sfx-spirit-chime', pos.x, pos.z, 0.8);
      },
      isComplete: () => this.collected[index],
    };
  }

  // ——— Dialogues & interactions ———

  private setupInteractables(): void {
    const d = this.deps;
    // L'Oracle : intro tant que la quête n'a pas commencé, finale à l'étape retour
    d.interactables.add({
      id: 'oracle',
      position: d.throneRoom.oraclePos,
      radius: 3.6,
      prompt: () => {
        if (!d.throneRoom.isInside(d.player.position) || d.dialogue.isOpen) return null;
        if (!this.started) return 'Parler à Marfoucha';
        if (this.quest.current?.id === 'retour' && !this.finaleDone) return 'Remettre les Éclats de l’Hiver';
        // En cours de quête, l'Oracle reste joignable : elle rappelle l'objectif.
        if (!this.quest.isFinished) return 'Parler à Marfoucha';
        return null;
      },
      action: () => {
        if (!this.started) this.showIntroDialogue();
        else if (this.quest.current?.id === 'retour' && !this.finaleDone) this.showFinalDialogue();
        else if (!this.quest.isFinished) this.showHintDialogue();
      },
    });
    // Les 3 Éclats
    for (let i = 0; i < 3; i++) {
      const shard = d.shards[i];
      d.interactables.add({
        id: `shard-${i}`,
        position: shard.position,
        radius: 2.8,
        prompt: () => (shard.isShown && !this.collected[i] ? SHARD_LABEL : null),
        action: () => this.collectShard(i),
      });
    }
  }

  private collectShard(i: number): void {
    if (this.collected[i]) return;
    this.collected[i] = true;
    const d = this.deps;
    const shard = d.shards[i];
    shard.setVisible(false);
    d.interactables.remove(`shard-${i}`);
    void d.audio?.play('sfx-shard-pickup', { volume: 0.9 });
    const p = shard.position;
    d.fx.particles.spawn(p.x, p.y + 1.3, p.z, 3, 26, {
      speed: 2.2, up: 2.4, spread: 1, life: [0.5, 1.1], size: [0.06, 0.16], color: 0x9fdcff,
    });
    d.fx.lights.flash(p.x, p.y + 1.4, p.z, 8, 0.7, 0x7fd4ff, 12);
    d.hud.banner(`Éclat de l’Hiver ${i + 1}/3`, 'Le Cœur se souvient…', '#9fdcff', 2.4);
  }

  /** Point focal caméra : tête de l'Oracle (~1,55 m au-dessus des pieds). */
  private oracleFocus(): THREE.Vector3 | undefined {
    const o = this.deps.oracle;
    if (!o) return undefined;
    return new THREE.Vector3(o.position.x, o.position.y + 1.55, o.position.z);
  }

  private showIntroDialogue(): void {
    const d = this.deps;
    this.lockPlayer(true);
    d.audio?.duck(0.3);
    d.dialogue.show(
      [
        { speaker: ORACLE_NAME, text: 'Bienvenue, Voyageuse. Je suis Marfoucha, Oracle de la Tsarine.' },
        { speaker: ORACLE_NAME, text: 'Le Cœur de l’Hiver s’est brisé en trois éclats — sans lui, l’aurore s’éteindra à jamais.' },
        { speaker: ORACLE_NAME, text: 'Rallumez les braseros de Beryozka, délivrez la fontaine, puis suivez le renard-esprit.' },
        { speaker: ORACLE_NAME, text: 'Prenez ces ailes, et allez rallumer la flamme de l’Hiver.' },
      ],
      {
        audio: d.audio,
        focus: this.oracleFocus(),
        onEnd: () => {
          this.lockPlayer(false);
          this.acceptQuest();
        },
      },
    );
  }

  private acceptQuest(): void {
    const d = this.deps;
    this.started = true;
    d.oracle?.setMarker(false);
    // Récompense immédiate : les ailes du vent (planage débloqué)
    d.player.glideUnlocked = true;
    d.hud.setGliderUnlocked(true);
    void d.audio?.play('sfx-updraft', { volume: 0.7 });
    d.hud.banner('Gadget débloqué', 'Planeur du vent — Espace en l’air', '#9fdcff', 3.2);
    this.quest.start('Le Cœur de l’Hiver', this.catalog);
  }

  /** Rappel de l'objectif courant quand on reparle à l'Oracle en cours de quête. */
  private showHintDialogue(): void {
    const d = this.deps;
    const step = this.quest.current;
    const text =
      (step && ORACLE_HINTS[step.id]) ??
      'Le Cœur de l’Hiver attend, Voyageuse. Suivez le losange doré de votre mission.';
    this.lockPlayer(true);
    d.audio?.duck(0.3);
    d.dialogue.show([{ speaker: ORACLE_NAME, text }], {
      audio: d.audio,
      focus: this.oracleFocus(),
      onEnd: () => this.lockPlayer(false),
    });
  }

  private showFinalDialogue(): void {
    const d = this.deps;
    this.lockPlayer(true);
    d.audio?.duck(0.3);
    d.dialogue.show(
      [
        { speaker: ORACLE_NAME, text: 'Les trois éclats… Approchez, et regardez le Cœur se souvenir de sa forme.' },
        { speaker: ORACLE_NAME, text: 'L’aurore flamboiera ce soir en votre honneur. Snezhnaya se souviendra.' },
      ],
      {
        audio: d.audio,
        focus: this.oracleFocus(),
        onEnd: () => {
          this.lockPlayer(false);
          this.doFinale();
        },
      },
    );
  }

  private doFinale(): void {
    const d = this.deps;
    this.finaleDone = true;
    d.throneRoom.setHeartVisible(true);
    d.sky.boostAurora(60);
    void d.audio?.play('sfx-shard-pickup', { volume: 0.9 });
    this.musicOverride = 'mus-fanfare';
    this.finaleMusicT = 95;
    d.playerCombatHpFill?.();
    const p = d.throneRoom.heartPedestalPos;
    d.fx.lights.flash(p.x, p.y + 2, p.z, 12, 1.2, 0x7fd4ff, 16);
    // L'étape 'retour' se termine → bannière « Quête terminée » via QuestSystem
  }

  private onQuestComplete(): void {
    const d = this.deps;
    d.oracle?.setMarker(false);
    d.hud.banner('L’aurore renaît', 'Le Cœur de l’Hiver bat à nouveau', '#9fdcff', 4);
  }

  private lockPlayer(locked: boolean): void {
    this.deps.player.movementLocked = locked;
    this.deps.interactables.locked = locked;
    if (!locked) this.deps.audio?.duck(1);
  }

  /** Boucle : quête + éclats + bulle de l'Oracle. */
  update(dt: number, elapsed: number): void {
    const d = this.deps;
    if (!this.started) this.refreshIntroTracker();
    this.quest.update(dt, d.player.position);
    for (const shard of d.shards) shard.update(dt, elapsed);
    if (this.finaleMusicT > 0) {
      this.finaleMusicT -= dt;
      if (this.finaleMusicT <= 0) this.musicOverride = null;
    }
    // Bulle « ! » : l'Oracle a toujours quelque chose à dire tant que la
    // quête n'est pas terminée (intro, rappel d'objectif, remise des éclats)
    const marker =
      !d.dialogue.isOpen &&
      d.throneRoom.isInside(d.player.position) &&
      !this.quest.isFinished;
    d.oracle?.setMarker(marker);
  }
}
