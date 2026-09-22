import * as THREE from 'three';
import type { Hud } from '../../ui/Hud';

export interface QuestCounterDef {
  key: string;
  label: string;
  max: number;
}

export interface QuestStepDef {
  id: string;
  /** Titre affiché dans le tracker. */
  title: string;
  /** Objectif principal (les compteurs s'ajoutent dessous). */
  hint?: string;
  /** Cible du losange doré (fixe ou dynamique). */
  target?: { x: number; z: number } | (() => { x: number; z: number });
  counters?: QuestCounterDef[];
  start?(): void;
  update?(dt: number, playerPos: THREE.Vector3): void;
  /** Avance automatique dès que true (compteurs pleins si définis). */
  isComplete?(): boolean;
  /** Empêche l'auto-avance même si les compteurs sont pleins. */
  manualAdvance?: boolean;
}

/**
 * Machine à étapes de quête : chaque étape déclare titre/cible/compteurs,
 * le système synchronise le tracker HUD, déclenche les bannières dorées et
 * avance quand les compteurs sont pleins (ou via isComplete / advance()).
 */
export class QuestSystem {
  private steps: QuestStepDef[] = [];
  private stepIndex = -1;
  private counters = new Map<string, number>();
  private questTitle = '';
  private running = false;
  private finished = false;
  private readonly playerPosTmp = new THREE.Vector3();

  constructor(
    private readonly hud: Hud,
    private readonly onAllComplete?: () => void,
  ) {}

  get current(): QuestStepDef | null {
    return this.running && this.stepIndex >= 0 && this.stepIndex < this.steps.length
      ? this.steps[this.stepIndex]
      : null;
  }

  get index(): number {
    return this.stepIndex;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  start(title: string, steps: QuestStepDef[]): void {
    this.questTitle = title;
    this.steps = steps;
    this.stepIndex = -1;
    this.counters.clear();
    this.running = true;
    this.finished = false;
    this.hud.banner('Quête acceptée', title);
    this.advance();
  }

  /** Passe à l'étape suivante (bannière + start + synchro tracker). */
  advance(): void {
    if (!this.running || this.finished) return;
    const prev = this.current;
    if (prev) this.hud.banner('Objectif terminé', prev.title, '#8fd6a0');
    this.stepIndex++;
    if (this.stepIndex >= this.steps.length) {
      this.running = false;
      this.finished = true;
      this.hud.banner('Quête terminée', this.questTitle, '#ffd98a');
      this.hud.clearQuest();
      this.onAllComplete?.();
      return;
    }
    const step = this.steps[this.stepIndex];
    for (const c of step.counters ?? []) this.counters.set(c.key, 0);
    step.start?.();
    this.syncHud();
  }

  /** Incrémente un compteur de l'étape courante. */
  notifyCounter(key: string, n = 1): void {
    const step = this.current;
    if (!step?.counters?.some((c) => c.key === key)) return;
    this.counters.set(key, (this.counters.get(key) ?? 0) + n);
    this.syncHud();
    this.checkComplete();
  }

  setCounter(key: string, value: number): void {
    this.counters.set(key, value);
    this.syncHud();
    this.checkComplete();
  }

  getCounter(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    const step = this.current;
    if (!step) return;
    this.playerPosTmp.copy(playerPos);
    step.update?.(dt, this.playerPosTmp);
    this.checkComplete();
  }

  private checkComplete(): void {
    const step = this.current;
    if (!step || this.finished) return;
    if (step.manualAdvance) {
      if (step.isComplete?.()) this.advance();
      return;
    }
    if (step.isComplete) {
      if (step.isComplete()) this.advance();
      return;
    }
    if (step.counters?.length) {
      const done = step.counters.every((c) => (this.counters.get(c.key) ?? 0) >= c.max);
      if (done) this.advance();
    }
  }

  private syncHud(): void {
    const step = this.current;
    if (!step) return;
    const lines: { text: string; done: boolean }[] = [];
    if (step.hint) lines.push({ text: step.hint, done: false });
    for (const c of step.counters ?? []) {
      const n = this.counters.get(c.key) ?? 0;
      lines.push({ text: `${c.label} : ${Math.min(n, c.max)}/${c.max}`, done: n >= c.max });
    }
    const target = typeof step.target === 'function' ? step.target() : step.target;
    this.hud.setQuestTracker(step.title, lines, target ?? null);
  }

  /** Forçage debug (vérifications headless). */
  jumpTo(stepId: string): void {
    const i = this.steps.findIndex((s) => s.id === stepId);
    if (i < 0 || this.finished) return;
    this.stepIndex = i - 1;
    this.advance();
  }

  get diag(): { step: string | null; index: number; counters: Record<string, number>; finished: boolean } {
    return {
      step: this.current?.id ?? null,
      index: this.stepIndex,
      counters: Object.fromEntries(this.counters),
      finished: this.finished,
    };
  }
}
