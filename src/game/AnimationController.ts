import * as THREE from 'three';

export type LocomotionState = 'idle' | 'walk' | 'run' | 'air' | 'swim' | 'swimIdle' | 'glide';
export type CombatState =
  | 'attack1'
  | 'attack2'
  | 'attack3'
  | 'castE'
  | 'castQ'
  | 'hurt'
  | 'dead'
  | 'combatIdle'
  | 'slam'
  | 'swipe';
export type AnimState = LocomotionState | CombatState;

const STATE_PATTERNS: Record<AnimState, RegExp[]> = {
  idle: [/idle/i, /rest/i, /stand/i],
  walk: [/walk/i],
  run: [/run/i, /jog/i, /sprint/i],
  air: [/jump/i, /air/i, /fall/i],
  swim: [/swim.?forward/i, /freestyle|crawl|breaststroke/i],
  swimIdle: [/swim.?idle/i, /tread/i],
  glide: [/^glide/i, /bar.?hang/i, /glid|soar/i],
  attack1: [/left.?slash/i, /^attack$/i],
  attack2: [/thrust.?slash/i],
  attack3: [/charged.?slash/i],
  castE: [/charged.?spell.?cast/i, /spell.?cast/i],
  castQ: [/sword.?judgment/i, /judgment/i],
  hurt: [/hit.?reaction/i],
  dead: [/^dead$/i, /knock.?down|dying|fall.?dead/i],
  combatIdle: [/combat.?stance/i, /battle.?stance/i],
  slam: [/ground.?slam/i],
  swipe: [/reaping.?swing/i],
};

/** Repli quand un clip manque (ex. un seul clip de nage téléchargé). */
const STATE_FALLBACK: Partial<Record<AnimState, AnimState>> = {
  swim: 'swimIdle',
  swimIdle: 'swim',
  glide: 'air',
  attack2: 'attack1',
  attack3: 'attack1',
  combatIdle: 'idle',
  slam: 'swipe',
};

export class AnimationController {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimState, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private onceDone: (() => void) | null = null;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);

    for (const [state, patterns] of Object.entries(STATE_PATTERNS) as [AnimState, RegExp[]][]) {
      const clip = clips.find((c) => patterns.some((p) => p.test(c.name)));
      if (!clip) continue;
      this.actions.set(state, this.mixer.clipAction(clip));
    }

    if (this.actions.size === 0 && clips.length > 0) {
      this.actions.set('idle', this.mixer.clipAction(clips[0]));
    }

    const first = this.actions.get('idle') ?? [...this.actions.values()][0];
    if (first) {
      first.play();
      this.current = first;
    }

    this.mixer.addEventListener('finished', (e) => {
      const done = this.onceDone;
      if (done && e.action === this.current) {
        this.onceDone = null;
        done();
      }
    });

    if (clips.length > 0) {
      console.info(
        '[Anim] clips disponibles:',
        clips.map((c) => c.name).join(', '),
      );
    }
  }

  has(state: AnimState): boolean {
    return this.actions.has(state);
  }

  /** Durée du clip d'un état (secondes), 1 si absent. */
  duration(state: AnimState): number {
    const action = this.actions.get(state);
    return action ? action.getClip().duration : 1;
  }

  setState(state: AnimState, fade = 0.22): void {
    const fallback = STATE_FALLBACK[state];
    const next =
      this.actions.get(state) ??
      (fallback ? this.actions.get(fallback) : undefined) ??
      this.actions.get('idle');
    if (!next || next === this.current) return;
    this.onceDone = null;
    next.reset().setLoop(THREE.LoopRepeat, Infinity);
    next.play();
    this.current?.crossFadeTo(next, fade, false);
    this.current = next;
  }

  /**
   * Joue un clip une fois (attaques, casts, mort) puis revient à `returnTo`.
   * `timeScale` accélère le clip (combat nerveux). onDone à la fin du clip.
   */
  playOnce(
    state: CombatState,
    opts: {
      fade?: number;
      timeScale?: number;
      returnTo?: AnimState;
      onDone?: () => void;
    } = {},
  ): number {
    const fallback = STATE_FALLBACK[state];
    const action =
      this.actions.get(state) ?? (fallback ? this.actions.get(fallback) : undefined);
    if (!action) {
      opts.onDone?.();
      return 0;
    }
    const timeScale = opts.timeScale ?? 1;
    this.onceDone = () => {
      opts.onDone?.();
      if (opts.returnTo) this.setState(opts.returnTo, 0.18);
    };
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = timeScale;
    action.play();
    this.current?.crossFadeTo(action, opts.fade ?? 0.1, false);
    this.current = action;
    return action.getClip().duration / timeScale;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  /**
   * Clip courant + temps normalisé dans le clip [0, 1[ — utilisé par la
   * courbe d'ancrage animé des ennemis (décollement de pieds par pose).
   */
  currentClipTime(): { clip: THREE.AnimationClip; t: number } | null {
    if (!this.current) return null;
    const clip = this.current.getClip();
    if (!(clip.duration > 0)) return null;
    const t = THREE.MathUtils.clamp(this.current.time / clip.duration, 0, 0.9999);
    return { clip, t };
  }
}
