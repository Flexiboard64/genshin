import * as THREE from 'three';
import type { Assets } from './Assets';

/** Boucle en cours de lecture avec son gain de fondu. */
interface LiveLoop {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export interface AmbienceZone {
  x: number;
  z: number;
  radius: number;
  /** Clé d'ambiance (fichier boucle) ou null. */
  ambience: string | null;
  /** Clé de musique de zone (optionnelle). */
  music?: string;
  /** Plus la priorité est haute, plus la zone gagne à chevauchement. */
  priority: number;
}

/**
 * Moteur audio WebAudio : 4 bus (music / ambience / sfx / voice) sous un
 * master, boucles d'ambiance à fondu enchaîné par zones circulaires,
 * one-shots avec variation de pitch et atténuation/pan par distance.
 * Le contexte est débloqué au premier geste (pointer lock / clic / touche).
 */
/** Clés de boucles configurables par monde (défauts = Snezhnaya v0.5). */
export interface AudioKeys {
  /** Lit d'ambiance de base joué partout à l'extérieur. */
  wind?: string;
  /** Thème musical principal du monde. */
  theme?: string;
  /** Musique de combat. */
  combat?: string;
}

/** Fréquences du filtre d'immersion (passage caméra sous l'eau). */
const FILTER_OPEN_HZ = 19000;
const FILTER_UNDERWATER_HZ = 620;
/** Fondu entrant doux des boucles (constante λ du damp). */
const FADE_IN_RATE = 2.2;
/** Fondu sortant rapide : la couche remplacée s'efface en ~0,5 s (pas de superposition). */
const FADE_OUT_RATE = 5.5;

export class AudioEngine {
  private readonly ctx = new AudioContext();
  private readonly master: GainNode;
  private readonly buses: Record<'music' | 'ambience' | 'sfx' | 'voice', GainNode>;
  /** Lowpass d'immersion sous-marine sur le bus ambience. */
  private readonly ambFilter: BiquadFilterNode;
  private ambFilterTarget = FILTER_OPEN_HZ;
  private readonly keys: Required<AudioKeys>;
  private readonly decoded = new Map<string, AudioBuffer>();
  private readonly decoding = new Map<string, Promise<AudioBuffer | null>>();
  private readonly loops = new Map<string, LiveLoop>();
  /** key → gain cible (0 = arrêt en fondu). Recomputé par setZones/update. */
  private readonly desired = new Map<string, number>();
  private currentMusic: string | null = null;
  private duckLevel = 1;
  private duckTarget = 1;
  private muted: boolean;
  private roundRobin = new Map<string, number>();

  constructor(
    private readonly assets: Assets,
    private readonly zones: AmbienceZone[],
    keys: AudioKeys = {},
  ) {
    this.keys = {
      wind: keys.wind ?? 'amb-wind',
      theme: keys.theme ?? 'mus-theme',
      combat: keys.combat ?? 'mus-combat',
    };
    this.muted = new URLSearchParams(window.location.search).has('mute');
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    // Le bus ambience passe par un lowpass (immersion sous-marine)
    this.ambFilter = this.ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = FILTER_OPEN_HZ;
    this.ambFilter.Q.value = 0.6;
    this.ambFilter.connect(this.master);
    const ambienceGain = this.ctx.createGain();
    ambienceGain.gain.value = 0.8;
    ambienceGain.connect(this.ambFilter);
    this.buses = {
      music: this.bus(0.55),
      ambience: ambienceGain,
      sfx: this.bus(0.9),
      voice: this.bus(1.0),
    };
    const unlock = () => {
      void this.ctx.resume();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
  }

  private bus(level: number): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.value = level;
    gain.connect(this.master);
    return gain;
  }

  get unlocked(): boolean {
    return this.ctx.state === 'running';
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, this.ctx.currentTime + 0.2);
  }

  /** Baisse temporairement musique+ambiance (dialogues, cinématiques). */
  duck(level: number): void {
    this.duckTarget = level;
  }

  /** Décode paresseusement un buffer audio du manifest. */
  private async buffer(key: string): Promise<AudioBuffer | null> {
    const hit = this.decoded.get(key);
    if (hit) return hit;
    let pending = this.decoding.get(key);
    if (!pending) {
      pending = (async () => {
        const raw = this.assets.audioData(key);
        if (!raw) return null;
        try {
          const buf = await this.ctx.decodeAudioData(raw.slice(0));
          this.decoded.set(key, buf);
          return buf;
        } catch (err) {
          console.warn(`[Audio] décodage impossible "${key}"`, err);
          return null;
        }
      })();
      this.decoding.set(key, pending);
    }
    return pending;
  }

  /**
   * One-shot. `at` + `listener` donnent atténuation (1/d, portée 32 m) et
   * panoramique stéréo ; `pitchVar` ajoute une variation aléatoire ±.
   */
  async play(
    key: string,
    opts: {
      bus?: 'sfx' | 'voice' | 'music';
      volume?: number;
      pitch?: number;
      pitchVar?: number;
      at?: { x: number; z: number };
      listener?: THREE.Vector3;
    } = {},
  ): Promise<void> {
    if (this.muted) return;
    const buffer = await this.buffer(key);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = (opts.pitch ?? 1) + (opts.pitchVar ? (Math.random() * 2 - 1) * opts.pitchVar : 0);

    let volume = opts.volume ?? 1;
    let pan = 0;
    if (opts.at && opts.listener) {
      const dx = opts.at.x - opts.listener.x;
      const dz = opts.at.z - opts.listener.z;
      const d = Math.hypot(dx, dz);
      if (d > 32) return;
      volume *= 1 / (1 + d * 0.16);
      pan = THREE.MathUtils.clamp(dx / 18, -0.8, 0.8);
    }

    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(gain).connect(panner).connect(this.buses[opts.bus ?? 'sfx']);
    source.start();
  }

  /** Variante round-robin pour les répétitions (pas, swings) : suffixe `-1..n`. */
  playVariant(baseKey: string, count: number, opts: Parameters<AudioEngine['play']>[1] = {}): void {
    const i = (this.roundRobin.get(baseKey) ?? 0) % count;
    this.roundRobin.set(baseKey, i + 1);
    void this.play(`${baseKey}-${i + 1}`, opts);
  }

  /** Démarre/arrête une boucle avec fondu (gains lissés dans update). */
  private setDesired(key: string, target: number): void {
    this.desired.set(key, target);
  }

  private async ensureLoop(key: string): Promise<void> {
    if (this.loops.has(key)) return;
    const buffer = await this.buffer(key);
    if (!buffer || this.loops.has(key)) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    source.start();
    this.loops.set(key, { source, gain });
  }

  private connectLoop(key: string, bus: GainNode): void {
    this.loops.get(key)?.gain.connect(bus);
  }

  /**
   * Recalcule les boucles désirées depuis la position du joueur.
   * `indoor` coupe les ambiances extérieures (salle du trône).
   */
  setScene(
    playerPos: THREE.Vector3,
    opts: { indoor?: boolean; combat?: boolean; musicOverride?: string | null; underwater?: boolean } = {},
  ): void {
    const wanted = new Map<string, { target: number; bus: 'ambience' | 'music' }>();

    // Zone la plus prioritaire + profondeur du joueur dedans (0 bord → 1 cœur)
    let best: AmbienceZone | null = null;
    for (const zone of this.zones) {
      const d = Math.hypot(playerPos.x - zone.x, playerPos.z - zone.z);
      if (d > zone.radius) continue;
      if (!best || zone.priority > best.priority) best = zone;
    }
    let zoneDepth = 0;
    if (best?.ambience) {
      const d = Math.hypot(playerPos.x - best.x, playerPos.z - best.z);
      zoneDepth = THREE.MathUtils.clamp(
        1 - Math.max(0, (d - best.radius * 0.6) / (best.radius * 0.4)),
        0,
        1,
      );
    }

    // Musique : combat > override > zone > thème principal
    const music =
      (opts.combat ? this.keys.combat : null) ??
      opts.musicOverride ??
      (best?.music || null) ??
      (opts.indoor ? null : this.keys.theme);
    if (music !== this.currentMusic) {
      if (this.currentMusic) this.setDesired(this.currentMusic, 0);
      this.currentMusic = music;
      if (music) this.connectLoop(music, this.buses.music);
    }

    // Règle d'or : UNE SEULE couche mélodique à plein volume. Les boucles
    // « amb-* » sont issues d'un modèle de musique (Lyria) : les laisser à
    // fond SOUS le thème superposait deux musiques. Le thème s'efface donc
    // au profit de l'ambiance de zone (musique d'aire façon Genshin) ;
    // combat/fanfare relèguent l'ambiance à l'arrière-plan ; le lit de base
    // (vent/oiseaux) n'est plus qu'une texture discrète sous la musique.
    const specialMusic = !!(opts.combat || opts.musicOverride);
    if (music) {
      const isTheme = !specialMusic && music === this.keys.theme;
      wanted.set(music, { target: 0.8 * (isTheme ? 1 - zoneDepth : 1), bus: 'music' });
    }
    if (best?.ambience) {
      wanted.set(best.ambience, {
        target: 0.85 * zoneDepth * (specialMusic ? 0.35 : 1),
        bus: 'ambience',
      });
    }
    if (!opts.indoor) {
      wanted.set(this.keys.wind, {
        target: 0.32 * (1 - zoneDepth) * (music ? 0.4 : 1),
        bus: 'ambience',
      });
    }

    // Applique les cibles aux boucles connues et nouvelles
    this.ambFilterTarget = opts.underwater ? FILTER_UNDERWATER_HZ : FILTER_OPEN_HZ;
    for (const [key, w] of wanted) {
      this.setDesired(key, w.target);
      void this.ensureLoop(key).then(() => {
        this.connectLoop(key, this.buses[w.bus]);
      });
    }
    for (const key of this.loops.keys()) {
      if (!wanted.has(key)) this.setDesired(key, 0);
    }
  }

  /** Lissage des gains de boucles + ducking + filtre immersion (60 Hz, zéro alloc). */
  update(dt: number): void {
    this.duckLevel = THREE.MathUtils.damp(this.duckLevel, this.duckTarget, 5, dt);
    this.buses.music.gain.value = 0.55 * this.duckLevel;
    this.buses.ambience.gain.value = 0.8 * this.duckLevel;
    this.ambFilter.frequency.value = THREE.MathUtils.damp(
      this.ambFilter.frequency.value,
      this.ambFilterTarget,
      4,
      dt,
    );
    for (const [key, loop] of this.loops) {
      const target = (this.desired.get(key) ?? 0) * (this.muted ? 0 : 1);
      const current = loop.gain.gain.value;
      const rate = target > current ? FADE_IN_RATE : FADE_OUT_RATE;
      const next = THREE.MathUtils.damp(current, target, rate, dt);
      loop.gain.gain.value = next;
      if (target === 0 && next < 0.004) {
        try {
          loop.source.stop();
        } catch {
          /* déjà arrêté */
        }
        loop.gain.disconnect();
        this.loops.delete(key);
        this.desired.delete(key);
      }
    }
  }

  /** Diagnostic headless. */
  get diag(): { state: string; loops: string[]; buffers: number; music: string | null } {
    return {
      state: this.ctx.state,
      loops: [...this.loops.keys()],
      buffers: this.decoded.size,
      music: this.currentMusic,
    };
  }
}
