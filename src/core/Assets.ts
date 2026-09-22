import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type AssetType = 'texture' | 'gltf' | 'image' | 'audio';

export interface AssetDef {
  key: string;
  url: string;
  type: AssetType;
  /** Textures couleur uniquement (défaut true). Mettre false pour les data textures. */
  srgb?: boolean;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image: ${url}`));
    img.src = url;
  });
}

export class Assets {
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly models = new Map<string, GLTF>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly audio = new Map<string, ArrayBuffer>();

  async loadAll(defs: AssetDef[], onProgress: (ratio: number) => void): Promise<void> {
    const textureLoader = new THREE.TextureLoader();
    const gltfLoader = new GLTFLoader();
    let done = 0;

    await Promise.all(
      defs.map(async (def) => {
        try {
          if (def.type === 'texture') {
            const texture = await textureLoader.loadAsync(def.url);
            if (def.srgb !== false) texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = 8;
            this.textures.set(def.key, texture);
          } else if (def.type === 'gltf') {
            this.models.set(def.key, await gltfLoader.loadAsync(def.url));
          } else if (def.type === 'audio') {
            const res = await fetch(def.url);
            if (!res.ok) throw new Error(`http ${res.status}`);
            this.audio.set(def.key, await res.arrayBuffer());
          } else {
            this.images.set(def.key, await loadImage(def.url));
          }
        } catch (err) {
          console.warn(`[Assets] échec du chargement de "${def.key}" (${def.url})`, err);
        } finally {
          done++;
          onProgress(done / defs.length);
        }
      }),
    );
  }

  has(key: string): boolean {
    return this.textures.has(key) || this.models.has(key) || this.images.has(key) || this.audio.has(key);
  }

  texture(key: string): THREE.Texture {
    const texture = this.textures.get(key);
    if (!texture) throw new Error(`[Assets] texture inconnue: ${key}`);
    return texture;
  }

  model(key: string): GLTF | undefined {
    return this.models.get(key);
  }

  image(key: string): HTMLImageElement | undefined {
    return this.images.get(key);
  }

  audioData(key: string): ArrayBuffer | undefined {
    return this.audio.get(key);
  }
}
