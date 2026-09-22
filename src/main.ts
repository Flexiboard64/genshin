import './ui/main.css';

/**
 * Aiguilleur des mondes. Par défaut : Mondstadt (plaine) ; ?world=snezhnaya
 * charge le biome neige (le portail du spawn mène ici, et inversement).
 * Les deux boots sont importés dynamiquement : chaque monde ne paie que son
 * propre code (code-splitting Vite).
 */
const world = new URLSearchParams(window.location.search).get('world');

if (world === 'snezhnaya') {
  const { bootSnezhnaya } = await import('./worlds/snezhnaya/boot');
  void bootSnezhnaya();
} else {
  const { bootMondstadt } = await import('./worlds/mondstadt/boot');
  void bootMondstadt();
}
