import * as THREE from 'three';
import { BUILD_VERSION } from '../../core/version';
import { Engine } from '../../core/Engine';
import { Input } from '../../core/Input';
import { Assets, type AssetDef } from '../../core/Assets';
import { Quality } from '../../core/Quality';
import { HeightGrid, Terrain, terrainHeight, WATER_LEVEL, LAKE } from '../../world/Terrain';
import { Sky } from '../../world/Sky';
import { Lighting } from '../../world/Lighting';
import { Water } from '../../world/Water';
import { Splash } from '../../world/Splash';
import { Grass } from '../../world/Grass';
import { Vegetation } from '../../world/Vegetation';
import { Player, sanitizeClip } from '../../game/Player';
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
import { EnemyManager } from '../../game/combat/EnemyManager';
import { PlayerCombat } from '../../game/combat/PlayerCombat';
import { Fireballs } from '../../game/combat/Fireballs';
import { Portal } from '../../game/Portal';
import { AudioEngine, type AmbienceZone } from '../../core/AudioEngine';
import { GameSfx } from '../../game/GameSfx';
import type { CombatFx } from '../../game/combat/types';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { collectClips, cloneAs, texOr } from '../shared';

const VEGETATION_KEYS = [
  'tree-oak',
  'tree-pine',
  'tree-ginkgo',
  'bush-round',
  'bush-flower',
  'rock-mossy',
  'rock-sharp',
] as const;

/** Clips de combat du joueur : [clé manifest, nom canonique fuzzy-matché]. */
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

const HILICHURL_CLIPS = [
  ['hili-attack', 'Attack'],
  ['hili-hurt', 'Hit_Reaction'],
  ['hili-dead', 'Dead'],
  ['hili-walk', 'Monster_Walk'],
  ['hili-combat-idle', 'Combat_Stance'],
  ['hili-idle', 'Idle'],
  ['hili-run', 'Run'],
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

/** Zones d'ambiance : lac (clapotis) + portail (bourdonnement mystique). */
const AUDIO_ZONES: AmbienceZone[] = [
  { x: 6, z: 7, radius: 9, ambience: 'amb-portal', priority: 9 },
  { x: LAKE.x, z: LAKE.z, radius: 55, ambience: 'amb-water', priority: 4 },
];

/** Clés audio = noms exacts des fichiers (`amb-birds` = lit de base extérieur). */
const AUDIO_KEYS = [
  'amb-birds',
  'amb-water',
  'amb-portal',
  'mus-theme-mondstadt',
  'mus-combat',
  'sfx-step-grass-1',
  'sfx-step-grass-2',
  'sfx-step-grass-3',
  'sfx-jump',
  'sfx-land',
  'sfx-swim-1',
  'sfx-swim-2',
  'sfx-splash',
  'sfx-fire-cast',
  'sfx-fire-impact',
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
] as const;

const MANIFEST: AssetDef[] = [
  { key: 'grass', url: '/assets/textures/grass.jpg', type: 'texture' },
  { key: 'grass2', url: '/assets/textures/grass2.jpg', type: 'texture' },
  { key: 'dirt', url: '/assets/textures/dirt.jpg', type: 'texture' },
  { key: 'rock', url: '/assets/textures/rock.jpg', type: 'texture' },
  { key: 'sand', url: '/assets/textures/sand.jpg', type: 'texture' },
  { key: 'hero', url: '/assets/models/hero.glb', type: 'gltf' },
  { key: 'hero-walk', url: '/assets/models/anim-walk.glb', type: 'gltf' },
  { key: 'hero-run', url: '/assets/models/anim-run.glb', type: 'gltf' },
  { key: 'hero-idle', url: '/assets/models/anim-idle.glb', type: 'gltf' },
  { key: 'hero-swim', url: '/assets/models/anim-swim.glb', type: 'gltf' },
  { key: 'hero-swim-idle', url: '/assets/models/anim-swim-idle.glb', type: 'gltf' },
  { key: 'hero-attack-1', url: '/assets/models/anim-attack-1.glb', type: 'gltf' },
  { key: 'hero-attack-2', url: '/assets/models/anim-attack-2.glb', type: 'gltf' },
  { key: 'hero-attack-3', url: '/assets/models/anim-attack-3.glb', type: 'gltf' },
  { key: 'hero-cast-e', url: '/assets/models/anim-cast-e.glb', type: 'gltf' },
  { key: 'hero-cast-q', url: '/assets/models/anim-cast-q.glb', type: 'gltf' },
  { key: 'hero-hurt', url: '/assets/models/anim-hurt.glb', type: 'gltf' },
  { key: 'hero-dead', url: '/assets/models/anim-dead.glb', type: 'gltf' },
  { key: 'hero-combat-idle', url: '/assets/models/anim-combat-idle.glb', type: 'gltf' },
  { key: 'sword-pyro', url: '/assets/models/sword-pyro.glb', type: 'gltf' },
  { key: 'slime-pyro', url: '/assets/models/slime-pyro.glb', type: 'gltf' },
  { key: 'hilichurl', url: '/assets/models/hilichurl.glb', type: 'gltf' },
  { key: 'golem', url: '/assets/models/golem.glb', type: 'gltf' },
  { key: 'club', url: '/assets/models/club.glb', type: 'gltf' },
  { key: 'hili-attack', url: '/assets/models/hili-attack.glb', type: 'gltf' },
  { key: 'hili-hurt', url: '/assets/models/hili-hurt.glb', type: 'gltf' },
  { key: 'hili-dead', url: '/assets/models/hili-dead.glb', type: 'gltf' },
  { key: 'hili-walk', url: '/assets/models/hili-walk.glb', type: 'gltf' },
  { key: 'hili-combat-idle', url: '/assets/models/hili-combat-idle.glb', type: 'gltf' },
  { key: 'hili-idle', url: '/assets/models/hili-idle.glb', type: 'gltf' },
  { key: 'hili-run', url: '/assets/models/hili-run.glb', type: 'gltf' },
  { key: 'golem-slam', url: '/assets/models/golem-slam.glb', type: 'gltf' },
  { key: 'golem-swing', url: '/assets/models/golem-swing.glb', type: 'gltf' },
  { key: 'golem-hurt', url: '/assets/models/golem-hurt.glb', type: 'gltf' },
  { key: 'golem-dead', url: '/assets/models/golem-dead.glb', type: 'gltf' },
  { key: 'golem-walk', url: '/assets/models/golem-walk.glb', type: 'gltf' },
  { key: 'golem-idle', url: '/assets/models/golem-idle.glb', type: 'gltf' },
  { key: 'golem-run', url: '/assets/models/golem-run.glb', type: 'gltf' },
  { key: 'portal-gate', url: '/assets/models/portal-gate.glb', type: 'gltf' },
  ...AUDIO_KEYS.map(
    (key): AssetDef => ({ key, url: `/assets/audio/${key}.mp3`, type: 'audio' }),
  ),
  { key: 'vfx-portal-swirl', url: '/assets/fx/vfx-portal-swirl.png', type: 'texture' },
  { key: 'vfx-slash', url: '/assets/fx/vfx-slash.png', type: 'texture' },
  { key: 'vfx-circle', url: '/assets/fx/vfx-magic-circle.png', type: 'texture' },
  ...VEGETATION_KEYS.map(
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

export async function bootMondstadt(): Promise<void> {
  console.info(`[GenshinWeb] build ${BUILD_VERSION} — monde : Mondstadt`);
  const loading = new LoadingScreen();
  try {
    const assets = new Assets();
    await assets.loadAll(MANIFEST, (ratio) => loading.setProgress(ratio));

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const engine = new Engine(canvas);
    const input = new Input(canvas);

    const lighting = new Lighting(engine.scene);
    const sky = new Sky(engine.renderer, engine.scene, lighting.sunDirection);

    const grid = new HeightGrid(256);
    const terrain = new Terrain(
      assets.has('grass2') ? assets.texture('grass2') : texOr(assets, 'grass', 0x6f9b4e),
      texOr(assets, 'dirt', 0x8a6f4d),
      texOr(assets, 'rock', 0x8f8f88),
      texOr(assets, 'sand', 0xd9c27f),
    );
    engine.scene.add(terrain.mesh);

    const water = new Water(grid, lighting.sunDirection);
    engine.scene.add(water.mesh);

    const splashes = new Splash(engine.scene);

    const vegModels = new Map<string, GLTF>();
    for (const key of VEGETATION_KEYS) {
      const gltf = assets.model(key);
      if (gltf) vegModels.set(key, gltf);
    }
    const vegetation = new Vegetation(vegModels, grid);
    engine.scene.add(vegetation.group);

    // Capture de la minimap AVANT herbe et joueur (décor statique uniquement)
    const mapImage = captureTerrainMapImage(engine.renderer, engine.scene);

    const grass = new Grass(grid);
    engine.scene.add(grass.group);

    const heroClips: THREE.AnimationClip[] = [];
    for (const key of ['hero-walk', 'hero-run', 'hero-idle', 'hero-swim', 'hero-swim-idle']) {
      const gltf = assets.model(key);
      if (gltf) heroClips.push(...gltf.animations);
    }
    heroClips.push(...collectClips(assets, HERO_COMBAT_CLIPS));
    const hiliBase = collectClips(assets, HILICHURL_CLIPS);
    {
      // Repli : si un GLB idle/run a échoué à charger, clones dérivés
      const walk = hiliBase.find((c) => c.name === 'Monster_Walk');
      const stance = hiliBase.find((c) => c.name === 'Combat_Stance');
      if (!hiliBase.some((c) => c.name === 'Run')) {
        const run = cloneAs(walk, 'Run');
        if (run) hiliBase.push(run);
      }
      if (!hiliBase.some((c) => c.name === 'Idle')) {
        const idle = cloneAs(stance ?? walk, 'Idle');
        if (idle) hiliBase.push(idle);
      }
    }
    const hilichurlClips = hiliBase.map(sanitizeClip);
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
    player.position.y = terrainHeight(0, 0);
    // ?pos=x,z : téléportation au boot (vérification headless)
    const params = new URLSearchParams(window.location.search);
    const posParam = params.get('pos');
    if (posParam) {
      const [px, pz] = posParam.split(',').map(Number);
      if (Number.isFinite(px) && Number.isFinite(pz)) {
        player.position.x = px;
        player.position.z = pz;
        player.position.y = terrainHeight(px, pz);
      }
    }
    engine.scene.add(player.object);

    const chaseCamera = new ThirdPersonCamera(engine.camera, input);
    const hud = new Hud();
    hud.setMapImage(mapImage);
    hud.setRegion('Plaine de Mondstadt', 'Au-dessus du niveau de la mer');
    hud.setQuest('Le vent se lève', 'Rejoindre le lac', { x: 59, z: -96 });
    input.onPointerLockChange = (locked) => hud.setPointerLocked(locked);

    // ——— Combat : FX, ennemis, joueur ———
    const particles = new Particles(engine.scene);
    const decals = new GroundDecals(
      engine.scene,
      terrainHeight,
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
      slime: assets.model('slime-pyro'),
      hilichurl: assets.model('hilichurl'),
      golem: assets.model('golem'),
      club: assets.model('club'),
      hilichurlClips,
      golemClips,
      groundAt: terrainHeight,
      waterLevel: WATER_LEVEL,
      renderer: engine.renderer,
    });
    const fireballs = new Fireballs(
      engine.scene,
      enemies,
      fx,
      terrainHeight,
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
      groundAt: terrainHeight,
      onHudDamageFlash: () => hud.damageFlash(),
      onDeathFade: (show) => hud.setDeathFade(show),
    });

    // ——— v0.6 : paysage sonore (AudioEngine + SFX gameplay partagés) ———
    const audio = new AudioEngine(assets, AUDIO_ZONES, {
      wind: 'amb-birds',
      theme: 'mus-theme-mondstadt',
    });
    const gameSfx = new GameSfx(audio, { stepBase: 'sfx-step-grass', stepCount: 3, swimCount: 2 });
    fireballs.onImpact = (x, y, z) => {
      void audio.play('sfx-fire-impact', { at: { x, z }, listener: player.position, volume: 0.55, pitchVar: 0.08 });
    };
    playerCombat.onPyroAoe = (x, z) => gameSfx.pyroBlast(x, z);
    enemies.onEnemyDied = (e) => gameSfx.onEnemyDied(e);

    // ——— Portail vers Snezhnaya, près du spawn ———
    const portal = new Portal(engine.scene, {
      model: assets.model('portal-gate') ?? null,
      swirl: assets.has('vfx-portal-swirl') ? assets.texture('vfx-portal-swirl') : null,
      x: 6,
      z: 7,
      groundAt: terrainHeight,
      label: 'Voyager vers Snezhnaya',
      target: '?world=snezhnaya',
      onActivate: () => void audio.play('sfx-teleport', { volume: 0.8 }),
    });

    const quality = new Quality();
    const renderInfo = engine.renderer.info.render;

    engine.onUpdate((dt, elapsed) => {
      player.update(dt, chaseCamera.yaw, terrainHeight, {
        waterLevel: WATER_LEVEL,
        colliders: vegetation.colliders,
        onSplash: (x, y, z, s) => {
          splashes.burst(x, y, z, s);
          gameSfx.onSplash(s);
        },
        onBubble: (x, y, z) => splashes.bubble(x, y, z),
      });
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
      gameSfx.update(dt, player, playerCombat, enemies);
      audio.setScene(player.position, {
        underwater: engine.camera.position.y < WATER_LEVEL,
      });
      audio.update(dt);
      portal.update(dt, elapsed, player.position, input, hud);
      particles.update(dt, elapsed, engine.camera, engine.renderer.domElement.height);
      decals.update(dt);
      lights.update(dt);
      trail.update(elapsed);
      shake.update(dt);
      chaseCamera.update(dt, player.position, terrainHeight);
      shake.apply(engine.camera);
      lighting.follow(player.position);
      sky.update(dt, engine.camera.position);
      water.update(elapsed);
      splashes.update(dt, elapsed, engine.camera, engine.renderer.domElement.height);
      grass.update(elapsed, player.position, engine.camera.position);
      vegetation.update(elapsed);
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
      colliders: vegetation.colliders.length,
      water: water.mesh.parent === engine.scene,
      models: vegModels.size,
      world: 'mondstadt',
    };
    (window as unknown as Record<string, unknown>).__player = player;
    (window as unknown as Record<string, unknown>).__veg = vegetation;
    (window as unknown as Record<string, unknown>).__cam = chaseCamera;
    (window as unknown as Record<string, unknown>).__height = terrainHeight;
    (window as unknown as Record<string, unknown>).__enemies = enemies;
    (window as unknown as Record<string, unknown>).__combat = playerCombat;
    (window as unknown as Record<string, unknown>).__fireballs = fireballs;
    (window as unknown as Record<string, unknown>).__input = input;
    (window as unknown as Record<string, unknown>).__audio = audio;
    (window as unknown as Record<string, unknown>).__THREE = THREE;
    (window as unknown as Record<string, unknown>).__renderer = engine.renderer;
    (window as unknown as Record<string, unknown>).__templates = {
      hilichurl: assets.model('hilichurl'),
      golem: assets.model('golem'),
    };
    (window as unknown as Record<string, unknown>).__booted = true;

    // Mode démo (vérification headless) : ?demo simule une course après le chargement
    if (new URLSearchParams(window.location.search).has('demo')) {
      window.setTimeout(() => {
        for (const code of ['KeyW', 'ShiftLeft']) {
          window.dispatchEvent(new KeyboardEvent('keydown', { code }));
        }
      }, 800);
    }

    // Mode combat (vérification headless) : ?fight place près du camp de slimes
    // et déclenche combo → E → Q pour les captures
    if (new URLSearchParams(window.location.search).has('fight')) {
      player.position.x = 6;
      player.position.z = -20;
      player.position.y = terrainHeight(6, -20);
      window.setTimeout(() => playerCombat.debugAttack(), 700);
      window.setTimeout(() => playerCombat.debugE(), 2400);
      window.setTimeout(() => playerCombat.debugQ(), 4600);
    }
  } catch (err) {
    console.error('[Boot]', err);
    loading.fail(err instanceof Error ? err.message : String(err));
  }
}
