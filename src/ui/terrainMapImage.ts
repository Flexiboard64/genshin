import * as THREE from 'three';
import { TERRAIN_SIZE } from '../world/Terrain';

const MAP_RESOLUTION = 2048;

/**
 * Rend le terrain en orthographe plongée dans un render target, puis lit les pixels
 * dans un canvas réutilisable par la minimap. À appeler avant d'ajouter les entités
 * à la scène pour ne capturer que le décor.
 */
export function captureTerrainMapImage(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  size = TERRAIN_SIZE,
  background = 0x1d3a5f,
): HTMLCanvasElement {
  const previousFog = scene.fog;
  const previousBackground = scene.background;
  const previousShadows = renderer.shadowMap.enabled;

  scene.fog = null;
  scene.background = new THREE.Color(background);
  renderer.shadowMap.enabled = false;

  const target = new THREE.WebGLRenderTarget(MAP_RESOLUTION, MAP_RESOLUTION);
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const half = size / 2;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 1, 1000);
  camera.position.set(0, 500, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);

  const pixels = new Uint8Array(MAP_RESOLUTION * MAP_RESOLUTION * 4);
  renderer.readRenderTargetPixels(target, 0, 0, MAP_RESOLUTION, MAP_RESOLUTION, pixels);
  renderer.setRenderTarget(previousTarget);
  target.dispose();

  scene.fog = previousFog;
  scene.background = previousBackground;
  renderer.shadowMap.enabled = previousShadows;

  const canvas = document.createElement('canvas');
  canvas.width = MAP_RESOLUTION;
  canvas.height = MAP_RESOLUTION;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const image = ctx.createImageData(MAP_RESOLUTION, MAP_RESOLUTION);
  const rowBytes = MAP_RESOLUTION * 4;
  for (let y = 0; y < MAP_RESOLUTION; y++) {
    const src = (MAP_RESOLUTION - 1 - y) * rowBytes;
    image.data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
