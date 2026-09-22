import * as THREE from 'three';
import { BUILD_VERSION } from '../../core/version';
import { Engine } from '../../core/Engine';
import { Input } from '../../core/Input';
import { Assets, type AssetDef } from '../../core/Assets';
import { Quality } from '../../core/Quality';
import { HeightGrid } from '../../world/Terrain';
import { Lighting } from '../../world/Lighting';
import { Player } from '../../game/Player';
import { ThirdPersonCamera } from '../../game/ThirdPersonCamera';
import { LoadingScreen } from '../../ui/LoadingScreen';
import { Hud } from '../../ui/Hud';
import { captureTerrainMapImage } from '../../ui/terrainMapImage';
import { Particles } from '../../fx/Particles';
import { GroundDecals } from '../../fx/GroundDecals';
import { LightPulses } from '../../fx/LightPulses';
import { CameraShake } from '../../fx/CameraShake';
import { SwordTrail } from '../../fx/SwordTrail';
import { DamageNumbers } from '../../ui/DamageNumbers';
import { EnemyManager, type CampDef } from '../../game/combat/EnemyManager';
import { PlayerCombat } from '../../game/combat/PlayerCombat';
import { Fireballs } from '../../game/combat/Fireballs';
import { Portal } from '../../game/Portal';
import { calibrateSkinnedModel } from '../../game/combat/measureSkinned';
import { sanitizeClip } from '../../game/Player';
import { normalizeMeshyMaterials } from '../../core/materials';
import { AudioEngine, type AmbienceZone } from '../../core/AudioEngine';
import { GameSfx } from '../../game/GameSfx';
import { Interactables } from '../../game/Interactables';
import { Dialogue } from '../../ui/Dialogue';
import { CheatMenu } from '../../ui/CheatMenu';
import { DialogueCamera } from '../../game/DialogueCamera';
import { Npc } from '../../game/Npc';
import { Glider } from '../../game/Glider';
import { VillageBraziers } from '../../game/quest/VillageBraziers';
import { MeltTargets } from '../../game/quest/MeltTargets';
import { WispGuide } from '../../game/quest/WispGuide';
import {
  HeartShard,
  WinterHeart,
  MONOLITHS,
  AMBUSH,
  BOSS_POS,
  SHARD_POS,
} from '../../game/quest/winterHeart';
import { Town } from './Town';
import { ThroneRoom, THRONE, THRONE_DOOR_IN } from './ThroneRoom';
import type { CombatFx } from '../../game/combat/types';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { collectClips, cloneAs, texOr } from '../shared';
import {
  FOREST,
  FROZEN_LAKE,
  GORGE,
  ICE_LEVEL,
  PEAK,
  SNOW_SIZE,
  SPAWN,
  SnowTerrain,
  TOWN,
  snowHeight,
} from './SnowTerrain';
import { PolarSky } from './PolarSky';
import { Weather } from './Weather';
import { IceLake } from './IceLake';
import { Waterfall } from './Waterfall';
import { CrevasseGlow } from './CrevasseGlow';
import { SnowVegetation } from './SnowVegetation';
import { Palace, stairsHeight } from './Palace';

/** Pas de nage à Snezhnaya : la glace est solide, l'eau absente. */
const NO_WATER = -1000;

const VEGETATION_KEYS = [
  'tree-snow-pine-a',
  'tree-snow-pine-b',
  'tree-snow-fir-c',
  'tree-bare-frozen',
  'bush-snow',
  'ice-crystal-cluster',
  'ice-shard-spike',
  'rock-snow-a',
  'rock-ice-cliff',
  'snow-drift',
  'icicle-cluster',
  'frozen-log',
  'cryo-flower',
] as const;

const PALACE_KEYS = [
  'palace-facade',
  'palace-tower',
  'palace-wall',
  'palace-gate-arch',
  'fatui-banner',
  'fatui-brazier',
  'fatui-lantern-post',
  'statue-tsaritsa',
  'fatui-crate',
  'fatui-tent',
  'fatui-barrier',
  'wood-post-rail',
  'ice-bridge',
  'ruin-pillar-snow',
  'stone-arch-ruin',
  'fatui-obelisk',
] as const;

const HERO_COMBAT_CLIPS = [
  ['hero-attack-1', 'Left_Slash'],
  ['hero-attack-2', 'Thrust_Slash'],
  ['hero-attack-3', 'Charged_Slash'],
  ['hero-cast-e', 'Charged_Spell_Cast'],
  ['hero-cast-q', 'Sword_Judgment'],
  ['hero-hurt', 'Hit_Reaction'],
  ['hero-dead', 'Dead'],
  ['hero-combat-idle', 'Combat_Stance'],
] as const;

const FATUI_AGENT_CLIPS = [
  ['fatui-agent-idle', 'Idle'],
  ['fatui-agent-walk', 'Walk'],
  ['fatui-agent-run', 'Run'],
  ['fatui-agent-attack', 'Attack'],
  ['fatui-agent-hurt', 'Hit_Reaction'],
  ['fatui-agent-dead', 'Dead'],
] as const;

const FATUI_SKIRMISHER_CLIPS = [
  ['fatui-skirmisher-idle', 'Idle'],
  ['fatui-skirmisher-walk', 'Walk'],
  ['fatui-skirmisher-run', 'Run'],
  ['fatui-skirmisher-attack', 'Attack'],
  ['fatui-skirmisher-hurt', 'Hit_Reaction'],
  ['fatui-skirmisher-dead', 'Dead'],
] as const;

/** Camps Snezhnaya : gardes du palais (passifs), camp forestier, slimes du lac, camps de quête. */
const CAMPS: CampDef[] = [
  { kind: 'fatui-agent', x: 0, z: -114, count: 2, spread: 6, passive: true },
  { kind: 'fatui-skirmisher', x: -53, z: -51, count: 3, spread: 6 },
  { kind: 'slime-cryo', x: 54, z: 48, count: 4, spread: 6 },
  // Quête — embuscade du village (déclenchée par la fonte de la fontaine)
  { kind: 'slime-cryo', x: AMBUSH.x, z: AMBUSH.z, count: 3, spread: 5, dormant: true, noRespawn: true },
  // Quête — sentinelle du monolithe scellé (révélée à la fonte du sceau)
  { kind: 'slime-cryo', x: MONOLITHS[2].x, z: MONOLITHS[2].z, count: 1, spread: 2, dormant: true, noRespawn: true },
  // Quête — boss de l'île centrale (Gardien de Givre)
  { kind: 'golem', x: BOSS_POS.x, z: BOSS_POS.z, count: 1, spread: 0, dormant: true, noRespawn: true, variant: 'cryo' },
];

/** Modèles du village de Beryozka (Town.ts). */
const VILLAGE_KEYS = [
  'house-izba-a',
  'house-izba-b',
  'house-izba-c',
  'house-merchant',
  'bell-tower-village',
  'well-frozen',
  'fountain-frozen',
  'market-stall-a',
  'market-stall-b',
  'cart-wood',
  'sled-wood',
  'barrel-frost',
  'crate-village',
  'fence-wood',
  'lamp-post-village',
  'bench-snow',
  'wood-pile',
  'sign-post',
  'snowman',
  'gate-village',
  'ice-sculpture-swan',
  'ice-sculpture-stag',
  'lantern-string',
  'hay-cart',
] as const;

/** Props de quête posés par boot (forêt, piton, île). */
const QUEST_PROP_KEYS = [
  'monolith-rune-a',
  'monolith-rune-b',
  'monolith-rune-c',
  'ice-seal-barrier',
  'statue-fox-spirit',
  'bridge-wood',
  'ice-spire',
  'fragment-pedestal',
  'chest-ornate',
  'shrine-frost',
  'launch-stone',
] as const;

/** Modèles de la salle du trône (ThroneRoom.ts). */
const THRONE_KEYS = [
  'throne-ornate',
  'column-palace',
  'chandelier-ice',
  'stained-glass-cryo',
  'banner-tsaritsa',
  'candelabra',
  'guard-statue',
  'pedestal-heart',
] as const;

const GOLEM_CLIPS = [
  ['golem-slam', 'Charged_Ground_Slam'],
  ['golem-swing', 'Reaping_Swing'],
  ['golem-hurt', 'Hit_Reaction'],
  ['golem-dead', 'Dead'],
  ['golem-walk', 'Slow_Orc_Walk'],
  ['golem-idle', 'Idle'],
  ['golem-run', 'Run'],
] as const;

/** Zones d'ambiance réactive (priorité : trône > village > forêt > lac > palais > gorge). */
const AUDIO_ZONES: AmbienceZone[] = [
  { x: THRONE.x, z: THRONE.z, radius: 50, ambience: 'amb-palace', priority: 10 },
  { x: 66, z: -3, radius: 9, ambience: 'amb-portal', priority: 9 },
  { x: TOWN.x, z: TOWN.z, radius: 46, ambience: 'amb-village', priority: 6 },
  { x: FOREST.x, z: FOREST.z, radius: 54, ambience: 'amb-forest', priority: 5 },
  { x: FROZEN_LAKE.x, z: FROZEN_LAKE.z, radius: 46, ambience: 'amb-lake', priority: 4 },
  // Cascades de la gorge (ouest z=-30, est z=55) : rugissement local
  { x: GORGE.x, z: -30, radius: 26, ambience: 'amb-waterfall', priority: 4 },
  { x: GORGE.x, z: 55, radius: 26, ambience: 'amb-waterfall', priority: 4 },
  { x: 0, z: -118, radius: 56, ambience: 'amb-blizzard', priority: 3 },
  { x: GORGE.x, z: 0, radius: 85, ambience: 'amb-gorge', priority: 2 },
];

/** Clés audio = noms exacts des fichiers (`amb-wind` est ajouté à part → lit de vent de base). */
const AUDIO_KEYS = [
  'amb-blizzard',
  'amb-forest',
  'amb-village',
  'amb-gorge',
  'amb-lake',
  'amb-palace',
  'mus-theme',
  'mus-combat',
  'mus-fanfare',
  'sfx-step-1',
  'sfx-step-2',
  'sfx-step-3',
  'sfx-fire-whoosh',
  'sfx-fire-impact',
  'sfx-brazier-ignite',
  'sfx-ice-crack',
  'sfx-ice-melt',
  'sfx-spirit-chime',
  'sfx-shard-pickup',
  'sfx-glide-wind',
  'sfx-updraft',
  'sfx-ring-ding',
  'sfx-quest-jingle',
  'sfx-heavy-door',
  'sfx-village-bell',
  'sfx-boss-roar',
  'sfx-jump',
  'sfx-land',
  'sfx-fire-cast',
  'sfx-vortex-charge',
  'sfx-vortex-blast',
  'sfx-judgment-rise',
  'sfx-judgment-blast',
  'sfx-hit-1',
  'sfx-hit-2',
  'sfx-slime-squish',
  'sfx-enemy-attack',
  'sfx-enemy-die',
  'sfx-golem-slam',
  'sfx-player-hurt',
  'sfx-player-die',
  'sfx-orb',
  'sfx-energy-full',
  'sfx-teleport',
  'sfx-glide-deploy',
  'sfx-ui-blip',
  'amb-portal',
  'amb-waterfall',
] as const;

/** Chemin de l'esprit-guide : village → pont du ravin → forêt → monolithes. */
const WISP_PATH: ReadonlyArray<readonly [number, number]> = [
  [-47, 61],
  [-56, 38],
  [-62, 20],
  [-65, 14],
  [-68, -3],
  [-72, -26],
  [-75, -46],
  [MONOLITHS[0].x, MONOLITHS[0].z],
  [MONOLITHS[1].x, MONOLITHS[1].z],
  [MONOLITHS[2].x, MONOLITHS[2].z],
];

const MANIFEST: AssetDef[] = [
  { key: 'snow', url: '/assets/textures/snow.jpg', type: 'texture' },
  { key: 'ice', url: '/assets/textures/ice.jpg', type: 'texture' },
  { key: 'rock-snow', url: '/assets/textures/rock-snow.jpg', type: 'texture' },
  { key: 'paving-fatui', url: '/assets/textures/paving-fatui.jpg', type: 'texture' },
  { key: 'paving-village', url: '/assets/textures/paving-village.jpg', type: 'texture' },
  { key: 'path-snow', url: '/assets/textures/path-snow.jpg', type: 'texture' },
  { key: 'vfx-snowflake', url: '/assets/fx/vfx-snowflake.png', type: 'texture' },
  { key: 'vfx-fog-puff', url: '/assets/fx/vfx-fog-puff.png', type: 'texture' },
  { key: 'vfx-waterfall-foam', url: '/assets/fx/vfx-waterfall-foam.png', type: 'texture' },
  { key: 'vfx-portal-swirl', url: '/assets/fx/vfx-portal-swirl.png', type: 'texture' },
  { key: 'vfx-slash', url: '/assets/fx/vfx-slash.png', type: 'texture' },
  { key: 'vfx-circle', url: '/assets/fx/vfx-magic-circle.png', type: 'texture' },
  { key: 'hero', url: '/assets/models/hero.glb', type: 'gltf' },
  { key: 'hero-walk', url: '/assets/models/anim-walk.glb', type: 'gltf' },
  { key: 'hero-run', url: '/assets/models/anim-run.glb', type: 'gltf' },
  { key: 'hero-idle', url: '/assets/models/anim-idle.glb', type: 'gltf' },
  { key: 'hero-attack-1', url: '/assets/models/anim-attack-1.glb', type: 'gltf' },
  { key: 'hero-attack-2', url: '/assets/models/anim-attack-2.glb', type: 'gltf' },
  { key: 'hero-attack-3', url: '/assets/models/anim-attack-3.glb', type: 'gltf' },
  { key: 'hero-cast-e', url: '/assets/models/anim-cast-e.glb', type: 'gltf' },
  { key: 'hero-cast-q', url: '/assets/models/anim-cast-q.glb', type: 'gltf' },
  { key: 'hero-hurt', url: '/assets/models/anim-hurt.glb', type: 'gltf' },
  { key: 'hero-dead', url: '/assets/models/anim-dead.glb', type: 'gltf' },
  { key: 'hero-combat-idle', url: '/assets/models/anim-combat-idle.glb', type: 'gltf' },
  { key: 'hero-glide', url: '/assets/models/anim-glide.glb', type: 'gltf' },
  { key: 'sword-pyro', url: '/assets/models/sword-pyro.glb', type: 'gltf' },
  { key: 'slime-cryo', url: '/assets/models/slime-cryo.glb', type: 'gltf' },
  { key: 'fatui-agent', url: '/assets/models/fatui-agent.glb', type: 'gltf' },
  { key: 'fatui-skirmisher', url: '/assets/models/fatui-skirmisher.glb', type: 'gltf' },
  { key: 'fatui-agent-idle', url: '/assets/models/anim-fatui-agent-idle.glb', type: 'gltf' },
  { key: 'fatui-agent-walk', url: '/assets/models/anim-fatui-agent-walk.glb', type: 'gltf' },
  { key: 'fatui-agent-run', url: '/assets/models/anim-fatui-agent-run.glb', type: 'gltf' },
  { key: 'fatui-agent-attack', url: '/assets/models/anim-fatui-agent-attack.glb', type: 'gltf' },
  { key: 'fatui-agent-hurt', url: '/assets/models/anim-fatui-agent-hurt.glb', type: 'gltf' },
  { key: 'fatui-agent-dead', url: '/assets/models/anim-fatui-agent-dead.glb', type: 'gltf' },
  { key: 'fatui-skirmisher-idle', url: '/assets/models/anim-fatui-skirmisher-idle.glb', type: 'gltf' },
  { key: 'fatui-skirmisher-walk', url: '/assets/models/anim-fatui-skirmisher-walk.glb', type: 'gltf' },
  { key: 'fatui-skirmisher-run', url: '/assets/models/anim-fatui-skirmisher-run.glb', type: 'gltf' },
  { key: 'fatui-skirmisher-attack', url: '/assets/models/anim-fatui-skirmisher-attack.glb', type: 'gltf' },
  { key: 'fatui-skirmisher-hurt', url: '/assets/models/anim-fatui-skirmisher-hurt.glb', type: 'gltf' },
  { key: 'fatui-skirmisher-dead', url: '/assets/models/anim-fatui-skirmisher-dead.glb', type: 'gltf' },
  { key: 'portal-gate', url: '/assets/models/portal-gate.glb', type: 'gltf' },
  // ——— v0.5 « Le Cœur de l'Hiver » : village, quête, trône, PNJ, planeur, boss ———
  ...VILLAGE_KEYS.map(
    (key): AssetDef => ({ key, url: `/assets/models/${key}.glb`, type: 'gltf' }),
  ),
  ...QUEST_PROP_KEYS.map(
    (key): AssetDef => ({ key, url: `/assets/models/${key}.glb`, type: 'gltf' }),
  ),
  ...THRONE_KEYS.map(
    (key): AssetDef => ({ key, url: `/assets/models/${key}.glb`, type: 'gltf' }),
  ),
  { key: 'npc-oracle', url: '/assets/models/npc-oracle.glb', type: 'gltf' },
  { key: 'npc-oracle-idle', url: '/assets/models/oracle-idle.glb', type: 'gltf' },
  { key: 'glider-wings', url: '/assets/models/glider-wings.glb', type: 'gltf' },
  { key: 'golem', url: '/assets/models/golem.glb', type: 'gltf' },
  { key: 'golem-slam', url: '/assets/models/golem-slam.glb', type: 'gltf' },
  { key: 'golem-swing', url: '/assets/models/golem-swing.glb', type: 'gltf' },
  { key: 'golem-hurt', url: '/assets/models/golem-hurt.glb', type: 'gltf' },
  { key: 'golem-dead', url: '/assets/models/golem-dead.glb', type: 'gltf' },
  { key: 'golem-walk', url: '/assets/models/golem-walk.glb', type: 'gltf' },
  { key: 'golem-idle', url: '/assets/models/golem-idle.glb', type: 'gltf' },
  { key: 'golem-run', url: '/assets/models/golem-run.glb', type: 'gltf' },
  { key: 'marble-frost', url: '/assets/textures/marble-frost.jpg', type: 'texture' },
  { key: 'ice-brick', url: '/assets/textures/ice-brick.jpg', type: 'texture' },
  { key: 'royal-carpet', url: '/assets/textures/royal-carpet.jpg', type: 'texture' },
  ...AUDIO_KEYS.map(
    (key): AssetDef => ({ key, url: `/assets/audio/${key}.mp3`, type: 'audio' }),
  ),
  // Lit de vent de base (AudioEngine.setScene le joue partout à l'extérieur)
  { key: 'amb-wind', url: '/assets/audio/amb-gorge.mp3', type: 'audio' },
  ...VEGETATION_KEYS.map(
    (key): AssetDef => ({ key, url: `/assets/models/${key}.glb`, type: 'gltf' }),
  ),
  ...PALACE_KEYS.map(
    (key): AssetDef => ({ key, url: `/assets/models/${key}.glb`, type: 'gltf' }),
  ),
  { key: 'ui-logo', url: '/assets/ui/logo.png', type: 'image' },
  { key: 'ui-portrait', url: '/assets/ui/portrait.png', type: 'image' },
  { key: 'ui-anemo', url: '/assets/ui/element-anemo.png', type: 'image' },
  { key: 'ui-geo', url: '/assets/ui/element-geo.png', type: 'image' },
  { key: 'ui-electro', url: '/assets/ui/element-electro.png', type: 'image' },
  { key: 'ui-dendro', url: '/assets/ui/element-dendro.png', type: 'image' },
  { key: 'ui-hydro', url: '/assets/ui/element-hydro.png', type: 'image' },
  { key: 'ui-pyro', url: '/assets/ui/element-pyro.png', type: 'image' },
  { key: 'ui-cryo', url: '/assets/ui/element-cryo.png', type: 'image' },
  { key: 'ui-skill-e', url: '/assets/ui/skill-e.png', type: 'image' },
  { key: 'ui-skill-q', url: '/assets/ui/skill-q.png', type: 'image' },
];

/**
 * Sol praticable : terrain neigeux surélevé par les marches de l'escalier
 * monumental (on MONTE dessus), avec la surface du lac gelé qui surélève
 * le fond (on MARCHE sur la glace, jamais de nage).
 */
export function snezhGround(x: number, z: number): number {
  const h = Math.max(snowHeight(x, z), stairsHeight(x, z));
  const lakeDist = Math.hypot(x - FROZEN_LAKE.x, z - FROZEN_LAKE.z);
  const blend = 1 - Math.min(1, Math.max(0, (lakeDist - FROZEN_LAKE.radius * 0.8) / 6));
  if (blend <= 0) return h;
  return Math.max(h, h * (1 - blend) + ICE_LEVEL * blend);
}

export async function bootSnezhnaya(): Promise<void> {
  console.info(`[GenshinWeb] build ${BUILD_VERSION} — monde : Snezhnaya`);
  const loading = new LoadingScreen('/assets/ui/loading-snezhnaya.jpg');
  try {
    const assets = new Assets();
    await assets.loadAll(MANIFEST, (ratio) => loading.setProgress(ratio));

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const engine = new Engine(canvas);
    const input = new Input(canvas);

    // Crépuscule polaire : soleil très bas à l'est, lumière froide
    const lighting = new Lighting(engine.scene, {
      sunOffset: new THREE.Vector3(85, 24, -35),
      sunColor: 0xffc490,
      sunIntensity: 2.1,
      hemiSky: 0x8fa3d8,
      hemiGround: 0xcfdcf0,
      hemiIntensity: 0.85,
    });
    const sky = new PolarSky(engine.renderer, engine.scene, lighting.sunDirection);

    const grid = new HeightGrid(256, snowHeight, SNOW_SIZE);
    const terrain = new SnowTerrain(
      texOr(assets, 'snow', 0xe8eef8),
      texOr(assets, 'ice', 0x9fc4e0),
      texOr(assets, 'rock-snow', 0x8a93a8),
      texOr(assets, 'paving-fatui', 0x6a7590),
      texOr(assets, 'path-snow', 0xd8dfec),
      texOr(assets, 'paving-village', 0x9aa2b4),
    );
    engine.scene.add(terrain.mesh);

    const iceLake = new IceLake(
      assets.has('ice') ? assets.texture('ice') : null,
      lighting.sunDirection,
    );
    engine.scene.add(iceLake.group);

    const waterfalls = new Waterfall(
      assets.has('vfx-waterfall-foam') ? assets.texture('vfx-waterfall-foam') : null,
      assets.has('vfx-fog-puff') ? assets.texture('vfx-fog-puff') : null,
    );
    engine.scene.add(waterfalls.group);

    const pixelRatio = engine.renderer.getPixelRatio();
    const crevasseGlow = new CrevasseGlow(pixelRatio);
    engine.scene.add(crevasseGlow.group);

    const vegModels = new Map<string, GLTF>();
    for (const key of VEGETATION_KEYS) {
      const gltf = assets.model(key);
      if (gltf) vegModels.set(key, gltf);
    }
    const vegetation = new SnowVegetation(vegModels, grid);
    engine.scene.add(vegetation.group);

    const palaceModels = new Map<string, GLTF>();
    for (const key of PALACE_KEYS) {
      const gltf = assets.model(key);
      if (gltf) palaceModels.set(key, gltf);
    }
    const palace = new Palace(
      palaceModels,
      snezhGround,
      assets.has('paving-fatui') ? assets.texture('paving-fatui') : null,
    );
    engine.scene.add(palace.group);

    // ——— v0.5 : village de Beryozka + salle du trône + props de quête ———
    const villageModels = new Map<string, GLTF>();
    for (const key of VILLAGE_KEYS) {
      const gltf = assets.model(key);
      if (gltf) villageModels.set(key, gltf);
    }
    // Braseros de quête : modèle partagé avec le palais (PALACE_KEYS) ;
    // pont du ravin : modèle partagé avec les props de quête (QUEST_PROP_KEYS)
    for (const shared of ['fatui-brazier', 'bridge-wood'] as const) {
      const gltf = assets.model(shared);
      if (gltf) villageModels.set(shared, gltf);
    }
    const town = new Town(
      villageModels,
      snezhGround,
      assets.has('vfx-fog-puff') ? assets.texture('vfx-fog-puff') : null,
    );
    engine.scene.add(town.group);

    const throneModels = new Map<string, GLTF>();
    for (const key of THRONE_KEYS) {
      const gltf = assets.model(key);
      if (gltf) throneModels.set(key, gltf);
    }
    const throneRoom = new ThroneRoom(throneModels, {
      floor: texOr(assets, 'marble-frost', 0xb8c4d8),
      walls: texOr(assets, 'ice-brick', 0x8fa8c8),
      carpet: texOr(assets, 'royal-carpet', 0x6a2a3a),
    });
    engine.scene.add(throneRoom.group);

    // Props de quête (clone + normalisation + échelle par hauteur cible)
    const propColliders: { x: number; z: number; r: number }[] = [];
    const placeProp = (
      key: string,
      x: number,
      z: number,
      opts: { targetHeight: number; rotY?: number; sink?: number; colliderR?: number; readable?: boolean; yAt?: number },
    ): THREE.Object3D | null => {
      const gltf = assets.model(key);
      if (!gltf) {
        console.warn(`[Props] modèle "${key}" indisponible — ignoré`);
        return null;
      }
      const root = gltf.scene.clone(true);
      root.updateMatrixWorld(true);
      normalizeMeshyMaterials(root, 0.95);
      const box = new THREE.Box3().setFromObject(root);
      const s = opts.targetHeight / Math.max(box.max.y - box.min.y, 0.01);
      root.scale.setScalar(s);
      root.rotation.y = opts.rotY ?? 0;
      const gy = opts.yAt ?? snezhGround(x, z);
      root.position.set(x, gy - box.min.y * s - (opts.sink ?? 0.12), z);
      root.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      if (opts.readable) {
        root.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            if (!std.isMeshStandardMaterial) continue;
            if (std.map && !std.emissiveMap) std.emissiveMap = std.map;
            std.emissive = new THREE.Color(0xffffff);
            std.emissiveIntensity = 0.3;
          }
        });
      }
      engine.scene.add(root);
      if (opts.colliderR) propColliders.push({ x, z, r: opts.colliderR });
      return root;
    };

    // Statue du renard-esprit au bord du chemin, avant le pont du ravin
    placeProp('statue-fox-spirit', -66, 5, { targetHeight: 2.6, rotY: 0.9, readable: true, colliderR: 0.9 });
    // Pont de bois sur le ravin ouest (ancré au niveau des berges, pas du fond)
    const bridgeX = -65.3;
    const bridgeZ = 14;
    const rimY = Math.max(snowHeight(bridgeX - 9, bridgeZ), snowHeight(bridgeX + 9, bridgeZ));
    placeProp('bridge-wood', bridgeX, bridgeZ, { targetHeight: 3.1, rotY: Math.PI / 2, yAt: rimY + 0.35, sink: 0 });
    // Monolithes runiques (décor) ; UN SEUL sceau de glace à fondre : celui du
    // monolithe où s'arrête l'esprit-guide (dernier point de WISP_PATH)
    const monolithKeys = ['monolith-rune-a', 'monolith-rune-b', 'monolith-rune-c'] as const;
    for (let i = 0; i < 3; i++) {
      const m = MONOLITHS[i];
      placeProp(monolithKeys[i], m.x, m.z, { targetHeight: 5.2, rotY: 0.4 + i * 1.1, readable: true, colliderR: 1.5 });
    }
    const SEAL_MONOLITH = 2;
    const sealPos = MONOLITHS[SEAL_MONOLITH];
    const sealObject = placeProp('ice-seal-barrier', sealPos.x, sealPos.z + 2.1, {
      targetHeight: 2.7,
      rotY: SEAL_MONOLITH * 0.7,
      readable: true,
    });
    // Aiguille de glace de l'île centrale (repère du boss)
    placeProp('ice-spire', FROZEN_LAKE.x, FROZEN_LAKE.z, { targetHeight: 8.5, readable: true, colliderR: 2.6 });
    // Sanctuaire du piton de planage + pierre de lancement
    placeProp('shrine-frost', PEAK.x - 2.5, PEAK.z - 3, { targetHeight: 2.3, readable: true, colliderR: 0.9 });
    placeProp('launch-stone', PEAK.x + 4.5, PEAK.z + 4, { targetHeight: 1.1, rotY: 0.9 });
    // Coffre de récompense dans la salle du trône (sol intérieur à y=0)
    placeProp('chest-ornate', THRONE.x + 5.5, THRONE.z - 10.5, { targetHeight: 1.0, rotY: -0.6, yAt: THRONE.floorY, sink: 0 });

    // Capture de la minimap AVANT météo et joueur (décor statique uniquement)
    const mapImage = captureTerrainMapImage(engine.renderer, engine.scene, SNOW_SIZE, 0x22344f);

    const weather = new Weather(
      assets.has('vfx-snowflake') ? assets.texture('vfx-snowflake') : null,
      assets.has('vfx-fog-puff') ? assets.texture('vfx-fog-puff') : null,
      snezhGround,
    );
    engine.scene.add(weather.group);

    const heroClips: THREE.AnimationClip[] = [];
    for (const key of ['hero-walk', 'hero-run', 'hero-idle']) {
      const gltf = assets.model(key);
      if (gltf) heroClips.push(...gltf.animations);
    }
    heroClips.push(...collectClips(assets, HERO_COMBAT_CLIPS));
    heroClips.push(...collectClips(assets, [['hero-glide', 'Glide']]));
    const fatuiAgentClips = collectClips(assets, FATUI_AGENT_CLIPS);
    const fatuiSkirmisherClips = collectClips(assets, FATUI_SKIRMISHER_CLIPS);
    // Boss Gardien de Givre : golem de Mondstadt en variante cryo (palette code)
    const golemBase = collectClips(assets, GOLEM_CLIPS);
    {
      if (!golemBase.some((c) => c.name === 'Run')) {
        const walk = golemBase.find((c) => c.name === 'Slow_Orc_Walk');
        const run = cloneAs(walk, 'Run');
        if (run) golemBase.push(run);
      }
      if (!golemBase.some((c) => c.name === 'Idle')) {
        const walk = golemBase.find((c) => c.name === 'Slow_Orc_Walk');
        const idle = cloneAs(walk, 'Idle');
        if (idle) golemBase.push(idle);
      }
    }
    const golemClips = golemBase.map(sanitizeClip);

    const player = new Player(assets.model('hero'), heroClips, input);
    player.position.set(SPAWN.x, snezhGround(SPAWN.x, SPAWN.z), SPAWN.z);
    const params = new URLSearchParams(window.location.search);
    const posParam = params.get('pos');
    if (posParam) {
      const [px, pz] = posParam.split(',').map(Number);
      if (Number.isFinite(px) && Number.isFinite(pz)) {
        player.position.x = px;
        player.position.z = pz;
        player.position.y = snezhGround(px, pz);
      }
    }
    engine.scene.add(player.object);

    const chaseCamera = new ThirdPersonCamera(engine.camera, input);
    // Arrivée face à la gorge : le premier écran montre falaises, cascades et promontoire
    if (!params.has('pos') && !params.has('yaw')) chaseCamera.yaw = Math.PI / 2;
    const hud = new Hud();
    hud.setMapImage(mapImage, SNOW_SIZE);
    hud.setGroundAt(snezhGround);
    hud.setRegion('Snezhnaya', 'Plateau de Zapolyarny');
    // Objectif d'intro sans auto-complétion : « Terminée » prématuré interdit
    // (la suite = entrer par la porte F, puis parler à l'Oracle — refreshIntroTracker).
    hud.setQuest('Le Cœur de l’Hiver', 'Entrer dans le palais de la Tsarine', { x: 0, z: -123 }, false);
    input.onPointerLockChange = (locked) => hud.setPointerLocked(locked);

    // ——— Combat : FX, ennemis, joueur ———
    const particles = new Particles(engine.scene);
    const decals = new GroundDecals(
      engine.scene,
      snezhGround,
      assets.has('vfx-circle') ? assets.texture('vfx-circle') : null,
    );
    const lights = new LightPulses(engine.scene);
    const shake = new CameraShake();
    const trail = new SwordTrail(
      engine.scene,
      assets.has('vfx-slash') ? assets.texture('vfx-slash') : null,
    );
    const hudRoot = document.getElementById('hud') as HTMLElement;
    const damageNumbers = new DamageNumbers(hudRoot);
    const fx: CombatFx = {
      particles,
      decals,
      lights,
      shake,
      hitstop: (duration, scale) => engine.hitstop(duration, scale),
      damageNumber: (x, y, z, amount, kind, crit) =>
        damageNumbers.spawn(x, y, z, amount, kind, crit),
    };
    const enemies = new EnemyManager(engine.scene, {
      slime: undefined,
      hilichurl: undefined,
      golem: assets.model('golem'),
      club: undefined,
      hilichurlClips: [],
      golemClips,
      slimeCryo: assets.model('slime-cryo'),
      fatuiAgent: assets.model('fatui-agent'),
      fatuiSkirmisher: assets.model('fatui-skirmisher'),
      fatuiAgentClips,
      fatuiSkirmisherClips,
      groundAt: snezhGround,
      waterLevel: NO_WATER,
      renderer: engine.renderer,
      camps: CAMPS,
    });
    const fireballs = new Fireballs(
      engine.scene,
      enemies,
      fx,
      snezhGround,
      (hits) => playerCombat.addEnergy(Math.min(4 * hits, 10)),
    );
    const playerCombat = new PlayerCombat({
      player,
      input,
      enemies,
      fx,
      trail,
      sword: assets.model('sword-pyro')?.scene ?? null,
      fireballs,
      groundAt: snezhGround,
      onHudDamageFlash: () => hud.damageFlash(),
      onDeathFade: (show) => hud.setDeathFade(show),
    });

    // ——— v0.5 : audio, interactions, PNJ Oracle, systèmes de quête ———
    const audio = new AudioEngine(assets, AUDIO_ZONES);
    // v0.6 : SFX gameplay partagés (pas neige, sorts, combat, orbes)
    const gameSfx = new GameSfx(audio, { stepBase: 'sfx-step', stepCount: 3 });
    const interactables = new Interactables();
    const dialogue = new Dialogue();
    dialogue.onAdvance = () => void audio.play('sfx-ui-blip', { volume: 0.35, pitchVar: 0.06 });
    // Pendant un dialogue, les touches de jeu sont capturées par l'UI
    // (Espace avance le texte au lieu de faire sauter / planer / frapper) et
    // la caméra bascule en plan cinématique sur l'interlocuteur (façon Genshin).
    const dialogueCam = new DialogueCamera();
    const dialogueFocusFallback = new THREE.Vector3();
    dialogue.onOpenChange = (open) => {
      input.uiCapture = open;
      if (open) {
        const focus =
          dialogue.focusPoint ??
          dialogueFocusFallback.set(player.position.x, player.position.y + 1.5, player.position.z);
        dialogueCam.begin(engine.camera, focus, player.position);
      } else {
        dialogueCam.end();
        chaseCamera.syncFromCamera();
      }
    };

    // Ailes du planeur (attachées au dos, visibles seulement en planage)
    const wings = assets.model('glider-wings');
    if (wings) player.setWingsModel(wings.scene);

    // Marfoucha l'Oracle, devant le trône (gabarit calibré sur le rendu réel)
    const oracleGltf = assets.model('npc-oracle');
    const oracleClips = assets.model('npc-oracle-idle')?.animations ?? [];
    let oracle: Npc | null = null;
    if (oracleGltf) {
      calibrateSkinnedModel(engine.renderer, oracleGltf.scene, 1.78, oracleClips);
      oracle = new Npc(oracleGltf.scene, oracleClips, {
        x: throneRoom.oraclePos.x,
        y: THRONE.floorY,
        z: throneRoom.oraclePos.z,
        heading: 0,
        // Mesure rendu live (probe-oracle) : la mesure de calibration échoue
        // pour ce rig → repli squelette qui ancre ~0,53 m trop bas (le PNJ
        // était enfoncé dans le sol). Bas rendu stable sur tout le cycle idle.
        modelLift: 0.53,
      });
      engine.scene.add(oracle.object);
      // Éclairage dédié façon Genshin : sans key light, sa robe bleu nuit se
      // fond dans la salle sombre et on ne la voit pas depuis l'entrée (27 m).
      const op = throneRoom.oraclePos;
      const oracleKey = new THREE.PointLight(0xdceaff, 26, 11, 1.7);
      oracleKey.position.set(op.x + 0.4, THRONE.floorY + 3.6, op.z + 2.2);
      engine.scene.add(oracleKey);
      const oracleFill = new THREE.PointLight(0xffd9a8, 7, 6, 1.8);
      oracleFill.position.set(op.x - 1.6, THRONE.floorY + 1.2, op.z + 2.8);
      engine.scene.add(oracleFill);
    }

    // Braseros du village (éteints) + cibles de fonte pyro
    const braziers = new VillageBraziers(
      engine.scene,
      town.brazierPositions.map((p) => new THREE.Vector3(p.x, snezhGround(p.x, p.z), p.z)),
      fx,
    );
    const meltTargets = new MeltTargets(fx);

    // Esprit-guide : spline village → pont → forêt → monolithes
    const wispWaypoints = WISP_PATH.map(([x, z]) => new THREE.Vector3(x, snezhGround(x, z) + 1.3, z));
    const wisp = new WispGuide(wispWaypoints, fx);
    engine.scene.add(wisp.object);

    // Planage : courants ascendants + 8 anneaux du piton vers l'île
    const glider = new Glider(fx);
    engine.scene.add(glider.group);
    {
      const peakY = snezhGround(PEAK.x, PEAK.z);
      for (let i = 0; i < 8; i++) {
        const t = (i + 1) / 9;
        const x = PEAK.x + (FROZEN_LAKE.x - PEAK.x) * t;
        const z = PEAK.z + (FROZEN_LAKE.z - PEAK.z) * t;
        const y = peakY + 3.5 - t * (peakY - 2) + Math.sin(t * Math.PI) * 6.5;
        glider.addRing(
          new THREE.Vector3(x, y, z),
          Math.atan2(FROZEN_LAKE.x - PEAK.x, FROZEN_LAKE.z - PEAK.z),
        );
      }
      const up1b = snezhGround(4, 2);
      glider.addUpdraft(4, 2, 5.5, up1b, up1b + 26);
      const up2b = snezhGround(23, 14);
      glider.addUpdraft(23, 14, 5.5, up2b, up2b + 26);
    }

    // Éclats de l'Hiver (piédestaux + cristaux, révélés par les étapes)
    const shards = SHARD_POS.map((p) => {
      let pedestal: THREE.Object3D | null = null;
      const gltf = assets.model('fragment-pedestal');
      if (gltf) {
        pedestal = gltf.scene.clone(true);
        pedestal.updateMatrixWorld(true);
        normalizeMeshyMaterials(pedestal, 0.95);
        const box = new THREE.Box3().setFromObject(pedestal);
        const s = 1.05 / Math.max(box.max.y - box.min.y, 0.01);
        pedestal.scale.setScalar(s);
        pedestal.position.y = -box.min.y * s;
        pedestal.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) child.castShadow = true;
        });
      }
      const shard = new HeartShard(p.x, snezhGround(p.x, p.z), p.z, pedestal);
      engine.scene.add(shard.object);
      return shard;
    });

    // La grande quête « Le Cœur de l'Hiver »
    const winterHeart = new WinterHeart({
      hud,
      dialogue,
      audio,
      player,
      playerCombatHpFill: () => {
        playerCombat.hp = playerCombat.hpMax;
      },
      enemies,
      interactables,
      oracle,
      throneRoom,
      braziers,
      meltTargets,
      wisp,
      glider,
      sky,
      fx,
      groundAt: snezhGround,
      shards,
    });

    // Menu de triche (touche M) : saut direct à une étape de la quête + téléport
    const cheatMenu = new CheatMenu({
      winterHeart,
      input,
      player,
      dialogue,
      hud,
      audio,
      groundAt: snezhGround,
    });

    // Cibles de fonte enregistrées (fontaine + le sceau unique du monolithe)
    if (town.fountainObject) {
      meltTargets.register(
        'fontaine',
        town.fountainObject,
        new THREE.Vector3(town.fountainPos.x, snezhGround(town.fountainPos.x, town.fountainPos.z), town.fountainPos.z),
        2.6,
        260,
        () => winterHeart.onMelted('fontaine'),
      );
    }
    if (sealObject) {
      meltTargets.register(
        `sceau-${SEAL_MONOLITH}`,
        sealObject,
        new THREE.Vector3(sealPos.x, snezhGround(sealPos.x, sealPos.z + 2.1), sealPos.z + 2.1),
        1.9,
        200,
        () => winterHeart.onMelted(`sceau-${SEAL_MONOLITH}`),
      );
    }

    // Câblage des impacts pyro → fonte + braseros + SFX
    fireballs.onImpact = (x, y, z) => {
      meltTargets.pyroHit(x, y, z);
      braziers.applyPyro(x, z, 2.2);
      void audio.play('sfx-fire-impact', { at: { x, z }, listener: player.position, volume: 0.55, pitchVar: 0.08 });
    };
    playerCombat.onPyroAoe = (x, z, radius) => {
      meltTargets.applyPyro(x, z, radius, 160);
      braziers.applyPyro(x, z, radius);
      gameSfx.pyroBlast(x, z);
    };
    braziers.onLit = (index, litCount) => winterHeart.onBrazierLit(index, litCount);
    enemies.onEnemyDied = (e) => {
      winterHeart.onEnemyDied(e);
      gameSfx.onEnemyDied(e);
    };
    glider.onRing = (index, count) => winterHeart.onRingPassed(index, count);

    // Portes du palais : entrée/sortie de la salle du trône (téléport à fondu)
    const doorOutPos = new THREE.Vector3(0, snezhGround(0, -123), -123);
    const enterThrone = (): void => {
      void audio.play('sfx-heavy-door', { volume: 0.85 });
      hud.fadeTeleport(() => {
        player.position.set(THRONE_DOOR_IN.x, THRONE.floorY, THRONE_DOOR_IN.z + 1.2);
        chaseCamera.yaw = 0; // face au trône (−z, le fond de la salle)
        winterHeart.refreshIntroTracker();
      });
    };
    const exitThrone = (): void => {
      void audio.play('sfx-heavy-door', { volume: 0.85 });
      hud.fadeTeleport(() => {
        player.position.set(0, snezhGround(0, -120), -120);
        chaseCamera.yaw = Math.PI; // face à l'escalier monumental (+z, le sud)
        winterHeart.refreshIntroTracker();
      });
    };
    interactables.add({
      id: 'throne-enter',
      position: doorOutPos,
      radius: 4,
      prompt: () => (throneRoom.isInside(player.position) ? null : 'Entrer dans le palais'),
      action: enterThrone,
    });
    interactables.add({
      id: 'throne-exit',
      position: new THREE.Vector3(THRONE_DOOR_IN.x, THRONE.floorY, THRONE_DOOR_IN.z),
      radius: 3.4,
      prompt: () => (throneRoom.isInside(player.position) ? 'Quitter le palais' : null),
      action: exitThrone,
    });

    // ——— Portail retour vers Mondstadt, sur le promontoire ———
    const portal = new Portal(engine.scene, {
      model: assets.model('portal-gate') ?? null,
      swirl: assets.has('vfx-portal-swirl') ? assets.texture('vfx-portal-swirl') : null,
      x: 66,
      z: -3,
      groundAt: snezhGround,
      label: 'Retourner à Mondstadt',
      target: '?world=mondstadt',
      onActivate: () => void audio.play('sfx-teleport', { volume: 0.8 }),
    });

    const colliders = [
      ...vegetation.colliders,
      ...palace.colliders,
      ...town.colliders,
      ...throneRoom.colliders,
      ...propColliders,
    ];
    const quality = new Quality();
    const renderInfo = engine.renderer.info.render;
    const flatThroneGround = (): number => THRONE.floorY;
    let indoor = false;
    let wasIndoor = false;
    let wasGliding = false;
    let inUpdraft = false;

    engine.onUpdate((dt, elapsed) => {
      indoor = throneRoom.isInside(player.position);
      const groundAt = indoor ? flatThroneGround : snezhGround;
      player.update(dt, chaseCamera.yaw, groundAt, {
        waterLevel: NO_WATER,
        colliders,
      });
      if (indoor) throneRoom.clampInside(player.position);
      playerCombat.update(dt, elapsed);
      fireballs.update(dt, elapsed);
      enemies.update(
        dt,
        player.position,
        playerCombat.alive,
        fx,
        elapsed,
        playerCombat.hurt,
        () => {
          playerCombat.onOrbPickup();
          gameSfx.onOrb();
        },
      );
      // ——— v0.5 : quête, fonte, braseros, esprit, planage, audio ———
      braziers.update(dt, elapsed);
      meltTargets.update(dt, elapsed);
      wisp.update(dt, elapsed, player.position);
      glider.update(dt, elapsed, player);
      interactables.update(player.position, hud, input);
      oracle?.update(dt, elapsed, player.position);
      winterHeart.update(dt, elapsed);
      town.update(dt);
      throneRoom.update(dt);
      if (indoor !== wasIndoor) {
        wasIndoor = indoor;
        hud.setIndoor(indoor);
      }
      if (player.gliding !== wasGliding) {
        wasGliding = player.gliding;
        if (player.gliding) {
          void audio.play('sfx-glide-deploy', { volume: 0.6 });
          void audio.play('sfx-glide-wind', { volume: 0.5 });
        }
      }
      if (player.gliding && player.glideLift > 0 && !inUpdraft) {
        inUpdraft = true;
        void audio.play('sfx-updraft', { volume: 0.75 });
      } else if (player.glideLift === 0) {
        inUpdraft = false;
      }
      // Pas sur la neige + SFX gameplay (saut, sorts, combat, orbes)
      gameSfx.update(dt, player, playerCombat, enemies, { indoor });
      audio.setScene(player.position, {
        indoor,
        combat: winterHeart.combatMusic,
        musicOverride: winterHeart.musicOverride,
      });
      audio.update(dt);
      portal.update(dt, elapsed, player.position, input, hud);
      particles.update(dt, elapsed, engine.camera, engine.renderer.domElement.height);
      decals.update(dt);
      lights.update(dt);
      trail.update(elapsed);
      shake.update(dt);
      if (dialogueCam.isActive) {
        dialogueCam.update(dt, engine.camera, groundAt);
      } else {
        chaseCamera.update(dt, player.position, groundAt);
        shake.apply(engine.camera);
      }
      lighting.follow(player.position);
      sky.update(dt, engine.camera.position);
      terrain.update(dt);
      iceLake.update(dt, engine.camera.position);
      waterfalls.update(dt);
      crevasseGlow.update(dt, pixelRatio);
      weather.update(dt, elapsed, engine.camera.position, pixelRatio);
      vegetation.update(elapsed);
      palace.update(dt);
      hud.update(dt, engine.camera, player);
      hud.updateCombat(engine.camera, playerCombat, enemies.enemies, elapsed, player.isSwimming);
      damageNumbers.update(dt, engine.camera);
      quality.tick({ triangles: renderInfo.triangles, calls: renderInfo.calls });
      (window as unknown as Record<string, unknown>).__stats = {
        triangles: renderInfo.triangles,
        calls: renderInfo.calls,
      };
    });

    loading.finish();
    engine.start();
    // Hooks de vérification headless
    (window as unknown as Record<string, unknown>).__diag = {
      veg: vegetation.group.children.length,
      colliders: colliders.length,
      palace: palace.group.children.length,
      models: vegModels.size + palaceModels.size,
      world: 'snezhnaya',
    };
    (window as unknown as Record<string, unknown>).__player = player;
    (window as unknown as Record<string, unknown>).__veg = vegetation;
    (window as unknown as Record<string, unknown>).__cam = chaseCamera;
    (window as unknown as Record<string, unknown>).__camera = engine.camera;
    (window as unknown as Record<string, unknown>).__height = snowHeight;
    (window as unknown as Record<string, unknown>).__enemies = enemies;
    (window as unknown as Record<string, unknown>).__combat = playerCombat;
    (window as unknown as Record<string, unknown>).__fireballs = fireballs;
    (window as unknown as Record<string, unknown>).__input = input;
    (window as unknown as Record<string, unknown>).__THREE = THREE;
    (window as unknown as Record<string, unknown>).__renderer = engine.renderer;
    (window as unknown as Record<string, unknown>).__scene = engine.scene;
    (window as unknown as Record<string, unknown>).__templates = {
      agent: assets.model('fatui-agent'),
      skirmisher: assets.model('fatui-skirmisher'),
    };
    // Hooks v0.5 (verify-v05.mjs)
    (window as unknown as Record<string, unknown>).__quest = winterHeart.quest;
    (window as unknown as Record<string, unknown>).__winter = winterHeart;
    (window as unknown as Record<string, unknown>).__cheat = cheatMenu;
    (window as unknown as Record<string, unknown>).__town = town;
    (window as unknown as Record<string, unknown>).__throne = throneRoom;
    (window as unknown as Record<string, unknown>).__audio = audio;
    (window as unknown as Record<string, unknown>).__wisp = wisp;
    (window as unknown as Record<string, unknown>).__glider = glider;
    (window as unknown as Record<string, unknown>).__dialogue = dialogue;
    (window as unknown as Record<string, unknown>).__throneEnter = enterThrone;
    (window as unknown as Record<string, unknown>).__throneExit = exitThrone;
    (window as unknown as Record<string, unknown>).__booted = true;

    // Mode démo (vérification headless) : ?demo simule une course après le chargement
    if (params.has('demo')) {
      window.setTimeout(() => {
        for (const code of ['KeyW', 'ShiftLeft']) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        }
      }, 800);
    }

    // Mode combat (vérification headless) : ?fight place près du lac gelé
    if (params.has('fight')) {
      player.position.x = 40;
      player.position.z = 8;
      player.position.y = snezhGround(40, 8);
      window.setTimeout(() => playerCombat.debugAttack(), 700);
      window.setTimeout(() => playerCombat.debugE(), 2400);
      window.setTimeout(() => playerCombat.debugQ(), 4600);
    }
  } catch (err) {
    console.error('[Boot]', err);
    loading.fail(err instanceof Error ? err.message : String(err));
  }
}
