import * as THREE from 'three';

/**
 * Calibration empirique d'un modèle skinné Meshy.
 *
 * Les exports riggés Meshy (remesh → rig) mélangent unités cm/m entre la
 * géométrie, l'armature (scale 0.01) et les clips : la bbox statique
 * (Box3.setFromObject) ne reflète PAS ce que le GPU dessine réellement.
 * On mesure donc la VÉRITÉ RENDUE : le modèle est dessiné seul dans un
 * render target orthographique et on compte les pixels opaques.
 *
 * Deux passes (grossière 200 m, fine ajustée) → hauteur rendue exacte et
 * position du bas (pieds) relative à l'origine de l'objet.
 */

export interface SkinnedMeasure {
  /** Hauteur réellement rendue (m). */
  height: number;
  /** Y monde du pixel le plus bas, relativement à l'origine de l'objet. */
  bottomY: number;
}

const RT_W = 64;
const RT_H = 256;

function renderOnce(
  renderer: THREE.WebGLRenderer,
  stage: THREE.Scene,
  camera: THREE.OrthographicCamera,
  centerY: number,
  spanY: number,
): { top: number; bottom: number } {
  camera.left = -spanY / 4;
  camera.right = spanY / 4;
  camera.top = centerY + spanY / 2;
  camera.bottom = centerY - spanY / 2;
  // La caméra recule avec le span pour garder le sujet dans le champ de profondeur
  camera.position.set(0, centerY, Math.max(10, spanY * 1.5));
  camera.far = Math.max(50, spanY * 3);
  camera.lookAt(0, centerY, 0);
  camera.updateProjectionMatrix();

  const prevRT = renderer.getRenderTarget();
  const rt = new THREE.WebGLRenderTarget(RT_W, RT_H);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(stage, camera);

  const buf = new Uint8Array(RT_W * RT_H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, RT_W, RT_H, buf);
  renderer.setRenderTarget(prevRT);
  rt.dispose();

  // Une ligne ne compte que si elle contient ≥ MIN_ROW_PX pixels éclairés :
  // les rigs Meshy laissent des vertex à poids nul qui dessinent une fine
  // lamelle verticale (1-2 px) du haut en bas du cadre — elle faussait le bas
  // mesuré (le golem était ancré sur ces débris et flottait de ~0,75 m).
  const MIN_ROW_PX = 3;
  let topRow = -1;
  let bottomRow = -1;
  for (let y = 0; y < RT_H; y++) {
    let lit = 0;
    for (let x = 0; x < RT_W; x++) {
      const i = (y * RT_W + x) * 4;
      // Seuil bas : la créature est sombre mais le fond est noir pur
      if (buf[i] > 6 || buf[i + 1] > 6 || buf[i + 2] > 6) lit++;
    }
    if (lit >= MIN_ROW_PX) {
      if (topRow === -1) topRow = y;
      bottomRow = y;
    }
  }
  if (topRow === -1) return { top: NaN, bottom: NaN };
  // Ligne 0 du buffer = bas de l'image (coordonnées GL)
  const worldTop = camera.bottom + ((bottomRow + 1) / RT_H) * spanY;
  const worldBottom = camera.bottom + (topRow / RT_H) * spanY;
  return { top: worldTop, bottom: worldBottom };
}

/**
 * Mesure le modèle dans sa pose actuelle. `object` est déplacé dans une scène
 * tampon le temps du rendu puis restauré. `worldPos` = position de l'objet.
 */
export function measureSkinned(
  renderer: THREE.WebGLRenderer,
  object: THREE.Object3D,
): SkinnedMeasure | null {
  const parent = object.parent;
  const savedPos = object.position.clone();
  const stage = new THREE.Scene();
  // Lumière franche pour que la silhouette dépasse du fond noir
  stage.add(new THREE.AmbientLight(0xffffff, 2.5));
  stage.add(object);
  object.position.set(0, 0, 0);
  // Les boundingSpheres des rigs Meshy sont fausses (unités mélangées) → le
  // frustum culling éliminerait le mesh du rendu de mesure
  const culled: THREE.Object3D[] = [];
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.frustumCulled) {
      mesh.frustumCulled = false;
      culled.push(mesh);
    }
  });
  object.updateMatrixWorld(true);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);

  try {
    // Balayage adaptatif : spans croissants jusqu'à détecter le sujet (les rigs
    // Meshy cassés peuvent rendre n'importe où entre 0,1 m et 300 m)
    let coarse = { top: NaN, bottom: NaN };
    for (const span of [6, 30, 150, 800]) {
      coarse = renderOnce(renderer, stage, camera, Math.max(1, span * 0.25), span);
      console.info(`[calibrate] span ${span} → top ${coarse.top}, bottom ${coarse.bottom}`);
      if (!Number.isNaN(coarse.top)) break;
    }
    if (Number.isNaN(coarse.top)) return null;
    const coarseH = Math.max(coarse.top - coarse.bottom, 0.05);

    // Passe fine : ajustée ×1,15 autour des bornes grossières
    const center = (coarse.top + coarse.bottom) / 2;
    const span = coarseH * 1.15;
    const fine = renderOnce(renderer, stage, camera, center, span);
    if (Number.isNaN(fine.top)) return null;

    return { height: fine.top - fine.bottom, bottomY: fine.bottom };
  } finally {
    for (const mesh of culled) mesh.frustumCulled = true;
    stage.remove(object);
    if (parent) parent.add(object);
    object.position.copy(savedPos);
    object.updateMatrixWorld(true);
  }
}

/** Y monde minimal du squelette (relatif à l'origine du modèle). */
function minBoneRelY(model: THREE.Object3D): number {
  model.updateMatrixWorld(true);
  let min = Infinity;
  const v = new THREE.Vector3();
  model.traverse((child) => {
    if ((child as THREE.Bone).isBone) {
      (child as THREE.Bone).getWorldPosition(v);
      if (v.y - model.position.y < min) min = v.y - model.position.y;
    }
  });
  return min;
}

/**
 * Courbe d'ancrage animé : bas RENDU du modèle à `steps` instants du cycle.
 * Les clips Meshy « en place » balaient fortement les pieds (jusqu'à ~0,6 m
 * de décollement visuel au milieu de la foulée) — cette courbe permet au jeu
 * de re-plaquer le corps au sol pose par pose (SkinnedEnemy.tickVisual).
 * Stockée dans `clip.userData.bottomCurve` + `minBottom`/`maxBottom`.
 */
export function sampleBottomCurve(
  renderer: THREE.WebGLRenderer,
  model: THREE.Object3D,
  clip: THREE.AnimationClip,
  steps = 24,
): Float32Array | null {
  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(clip);
  action.play();
  const curve = new Float32Array(steps);
  let ok = true;
  for (let k = 0; k < steps; k++) {
    mixer.setTime((k / steps) * clip.duration);
    const m = measureSkinned(renderer, model);
    if (!m) {
      ok = false;
      break;
    }
    curve[k] = m.bottomY;
  }
  mixer.stopAllAction();
  mixer.uncacheClip(clip);
  if (!ok) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of curve) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  clip.userData.bottomCurve = curve;
  clip.userData.minBottom = min;
  clip.userData.maxBottom = max;
  return curve;
}

/** Interpole la courbe d'ancrage d'un clip à l'instant normalisé t ∈ [0,1[. */
export function bottomCurveAt(clip: THREE.AnimationClip, t: number): number | null {
  const curve = clip.userData.bottomCurve as Float32Array | undefined;
  if (!curve || curve.length === 0 || !Number.isFinite(t)) return null;
  const f = THREE.MathUtils.clamp(t, 0, 0.9999) * curve.length;
  const i0 = Math.floor(f);
  const i1 = (i0 + 1) % curve.length;
  const frac = f - i0;
  const v = curve[i0] + (curve[i1] - curve[i0]) * frac;
  return Number.isFinite(v) ? v : null;
}

/**
 * Cale `model` à `targetHeight` mètres rendus, pieds posés sur y=0 (local).
 * Si `clips` est fourni : chaque clip reçoit sa courbe d'ancrage (userData),
 * et l'ancre statique vise le point le plus bas du cycle IDLE (sinon la
 * créature flotte quand l'idle porte les hanches plus haut que le bind).
 * Retourne false si la mesure a échoué (repli appelant).
 */
export function calibrateSkinnedModel(
  renderer: THREE.WebGLRenderer,
  model: THREE.Object3D,
  targetHeight: number,
  clips?: THREE.AnimationClip[],
): boolean {
  const idleClip = clips?.find((c) => /idle/i.test(c.name));
  model.scale.setScalar(1);
  model.position.y = 0;
  const first = measureSkinned(renderer, model);
  if (!first || first.height < 0.05) {
    // Repli analytique : envergure du squelette en pose de bind (os × armature)
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    let bones = 0;
    model.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        (child as THREE.Bone).getWorldPosition(v);
        box.expandByPoint(v);
        bones++;
      }
    });
    if (bones === 0) {
      console.warn('[calibrate] mesure impossible et pas de squelette');
      return false;
    }
    const boneH = Math.max(box.max.y - box.min.y, 0.05);
    // Les os couvrent cheville→cou : +25 % pour crâne/orteils
    const estimated = boneH * 1.25;
    const s = targetHeight / estimated;
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    if (idleClip) {
      // Repli : correction animée par les os (pas de rendu fiable ici)
      const bindMin = minBoneRelY(model);
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(idleClip).play();
      let animMin = Infinity;
      for (let k = 0; k <= 8; k++) {
        mixer.setTime((k / 8) * idleClip.duration);
        const m = minBoneRelY(model);
        if (m < animMin) animMin = m;
      }
      mixer.stopAllAction();
      mixer.uncacheClip(idleClip);
      if (Number.isFinite(bindMin) && Number.isFinite(animMin)) {
        const lift = animMin - bindMin;
        if (lift > 0.005) model.position.y -= lift;
      }
    }
    console.warn(
      `[calibrate] repli squelette : os ${boneH.toFixed(2)} m → estimé ${estimated.toFixed(2)} m, scale ${s.toFixed(3)}`,
    );
    return true;
  }
  const s = targetHeight / first.height;
  model.scale.setScalar(s);
  const second = measureSkinned(renderer, model);
  if (!second) {
    console.warn('[calibrate] seconde mesure impossible (scale', s.toFixed(3), ')');
    return false;
  }
  // Courbes d'ancrage pour chaque clip (locomotion + attaques) ; l'ancre
  // statique = point le plus bas du cycle idle (ou mesure bind à défaut)
  let minIdle = second.bottomY;
  if (clips) {
    for (const clip of clips) {
      const curve = sampleBottomCurve(renderer, model, clip);
      if (curve && clip === idleClip) {
        minIdle = clip.userData.minBottom as number;
      }
      if (curve) {
        console.info(
          `[calibrate] clip ${clip.name} : bas min ${(clip.userData.minBottom as number).toFixed(2)} / max ${(clip.userData.maxBottom as number).toFixed(2)}`,
        );
      }
    }
  }
  model.position.y = -minIdle - 0.04;
  console.info(
    `[calibrate] hauteur ${first.height.toFixed(2)} m → scale ${s.toFixed(3)}, ancre ${model.position.y.toFixed(3)}`,
  );
  return true;
}
