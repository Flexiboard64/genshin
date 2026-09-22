export class Quality {
  private readonly element: HTMLDivElement;
  private frames = 0;
  private lastSample = performance.now();
  private fps = 0;

  constructor() {
    this.element = document.createElement('div');
    this.element.id = 'perf-stats';
    this.element.style.cssText = [
      'position:fixed',
      'top:8px',
      'left:8px',
      'z-index:999',
      'padding:4px 10px',
      'border-radius:6px',
      'background:rgba(0,0,0,0.55)',
      'color:#7dff9b',
      'font:600 12px/1.4 monospace',
      'pointer-events:none',
      'display:none',
    ].join(';');
    document.body.appendChild(this.element);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.element.style.display = this.element.style.display === 'none' ? 'block' : 'none';
      }
    });
  }

  tick(rendererInfo: { triangles: number; calls: number }): void {
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.lastSample;
    if (elapsed < 500) return;

    this.fps = Math.round((this.frames * 1000) / elapsed);
    this.frames = 0;
    this.lastSample = now;
    this.element.textContent = `${this.fps} FPS · ${rendererInfo.calls} draw · ${(
      rendererInfo.triangles / 1000
    ).toFixed(0)}k tri`;
    this.element.style.color = this.fps >= 55 ? '#7dff9b' : this.fps >= 30 ? '#ffd97d' : '#ff7d7d';
  }
}
