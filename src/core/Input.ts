type Axis = { x: number; z: number };

const KEY_FORWARD = ['KeyW', 'ArrowUp'];
const KEY_BACK = ['KeyS', 'ArrowDown'];
const KEY_LEFT = ['KeyA', 'ArrowLeft'];
const KEY_RIGHT = ['KeyD', 'ArrowRight'];

export class Input {
  private readonly keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheelDelta = 0;
  private jumpQueued = false;
  private attackQueued = false;
  private attackHeldNow = false;
  private skillQueued = false;
  private burstQueued = false;
  private interactQueued = false;
  private locked = false;
  /** UI ouverte (dialogue…) : les touches de jeu ne déclenchent plus rien. */
  private captureUi = false;

  onPointerLockChange?: (locked: boolean) => void;

  /** Active/masque la capture UI ; purge les files pour ne pas reliquer un saut. */
  set uiCapture(v: boolean) {
    this.captureUi = v;
    if (v) {
      this.jumpQueued = false;
      this.attackQueued = false;
      this.attackHeldNow = false;
      this.skillQueued = false;
      this.burstQueued = false;
      this.interactQueued = false;
    }
  }

  get isUiCaptured(): boolean {
    return this.captureUi;
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (this.captureUi) {
        if (e.code === 'Space') e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      } else if (e.code === 'KeyE') {
        this.skillQueued = true;
      } else if (e.code === 'KeyR') {
        // R : déchaînement élémentaire (Q sert au déplacement latéral en ZQSD)
        this.burstQueued = true;
      } else if (e.code === 'KeyF') {
        this.interactQueued = true;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => {
      if (!this.locked) {
        // Premier clic = entrée en jeu : plein écran + pointer lock (geste
        // utilisateur requis pour les deux)
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        }
        canvas.requestPointerLock();
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.locked && !this.captureUi && e.button === 0) {
        this.attackQueued = true;
        this.attackHeldNow = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.attackHeldNow = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.onPointerLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        this.wheelDelta += Math.sign(e.deltaY);
      },
      { passive: true },
    );
  }

  get isPointerLocked(): boolean {
    return this.locked;
  }

  axis(): Axis {
    const x =
      (KEY_RIGHT.some((k) => this.keys.has(k)) ? 1 : 0) -
      (KEY_LEFT.some((k) => this.keys.has(k)) ? 1 : 0);
    const z =
      (KEY_BACK.some((k) => this.keys.has(k)) ? 1 : 0) -
      (KEY_FORWARD.some((k) => this.keys.has(k)) ? 1 : 0);
    return { x, z };
  }

  get sprinting(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Clic gauche maintenu (pointer lock) — tir continu de boules de feu. */
  get attackHeld(): boolean {
    return this.attackHeldNow && this.locked;
  }

  consumeJump(): boolean {
    const queued = this.jumpQueued;
    this.jumpQueued = false;
    return queued;
  }

  consumeAttack(): boolean {
    const queued = this.attackQueued;
    this.attackQueued = false;
    return queued;
  }

  consumeSkill(): boolean {
    const queued = this.skillQueued;
    this.skillQueued = false;
    return queued;
  }

  consumeBurst(): boolean {
    const queued = this.burstQueued;
    this.burstQueued = false;
    return queued;
  }

  /** Interaction contextuelle (portails, ramassage) — touche F. */
  consumeInteract(): boolean {
    const queued = this.interactQueued;
    this.interactQueued = false;
    return queued;
  }

  consumeMouseDelta(): { dx: number; dy: number } {
    const delta = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }

  consumeWheel(): number {
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    return delta;
  }
}
