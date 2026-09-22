import { BUILD_VERSION } from '../core/version';

const ELEMENTS = ['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo'] as const;

const TIPS = [
  'Astuce : maintenez Maj en courant pour sprinter. L\u2019endurance se régénère avec le temps.',
  'Astuce : la molette de la souris permet de régler la distance de la caméra.',
  'Astuce : appuyez sur F3 en jeu pour afficher le compteur de performances.',
];

export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly icons: HTMLImageElement[] = [];
  private readonly barFill: HTMLDivElement;
  private readonly percent: HTMLDivElement;

  constructor(backgroundUrl?: string) {
    this.root = document.createElement('div');
    this.root.id = 'loading-screen';
    if (backgroundUrl) {
      this.root.style.background = `linear-gradient(rgba(6,8,18,0.55), rgba(6,8,18,0.72)), url('${backgroundUrl}') center / cover no-repeat, #060812`;
    }

    const inner = document.createElement('div');
    inner.className = 'ls-inner';

    const logo = document.createElement('img');
    logo.className = 'ls-logo';
    logo.src = '/assets/ui/logo.png';
    logo.alt = 'Emblème du jeu';
    inner.appendChild(logo);

    const title = document.createElement('div');
    title.className = 'ls-title';
    title.textContent = 'GENSHIN WEB';
    inner.appendChild(title);

    const iconsRow = document.createElement('div');
    iconsRow.className = 'ls-icons';
    for (const element of ELEMENTS) {
      const icon = document.createElement('img');
      icon.src = `/assets/ui/element-${element}.png`;
      icon.alt = element;
      icon.className = `ls-icon ls-icon-${element}`;
      iconsRow.appendChild(icon);
      this.icons.push(icon);
    }
    inner.appendChild(iconsRow);

    const bar = document.createElement('div');
    bar.className = 'ls-bar';
    this.barFill = document.createElement('div');
    this.barFill.className = 'ls-bar-fill';
    bar.appendChild(this.barFill);
    inner.appendChild(bar);

    this.percent = document.createElement('div');
    this.percent.className = 'ls-percent';
    this.percent.textContent = '0 %';
    inner.appendChild(this.percent);

    const tip = document.createElement('div');
    tip.className = 'ls-tip';
    tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    inner.appendChild(tip);

    const version = document.createElement('div');
    version.className = 'ls-version';
    version.textContent = BUILD_VERSION;
    this.root.appendChild(version);

    this.root.appendChild(inner);
    document.getElementById('loading')?.appendChild(this.root);
  }

  setProgress(ratio: number): void {
    const clamped = Math.min(1, Math.max(0, ratio));
    const litCount = Math.floor(clamped * this.icons.length + 1e-6);
    this.icons.forEach((icon, i) => icon.classList.toggle('lit', i < litCount));
    this.barFill.style.width = `${clamped * 100}%`;
    this.percent.textContent = `${Math.round(clamped * 100)} %`;
  }

  finish(): void {
    this.setProgress(1);
    this.root.classList.add('done');
    window.setTimeout(() => this.root.remove(), 950);
  }

  fail(message: string): void {
    const tip = this.root.querySelector('.ls-tip');
    if (tip) {
      tip.textContent = `Erreur de chargement : ${message}`;
      tip.classList.add('ls-error');
    }
  }
}
