import * as THREE from 'three';

/**
 * Normalise les matériaux exportés par Meshy : emissiveFactor [1,1,1] qui rend le
 * modèle insensible aux lumières, specular x2 (KHR_materials_specular) qui le floute.
 */
export function normalizeMeshyMaterials(root: THREE.Object3D, brightness = 0.82): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const m = material as THREE.MeshStandardMaterial;
      m.emissive.setRGB(0, 0, 0);
      m.emissiveIntensity = 0;
      m.metalness = Math.min(m.metalness ?? 0, 0.1);
      m.roughness = Math.max(m.roughness ?? 1, 0.75);
      m.envMapIntensity = 0.3;
      m.color.setRGB(brightness, brightness, brightness);
      const physical = m as THREE.MeshPhysicalMaterial;
      if (physical.specularIntensity !== undefined) physical.specularIntensity = 0.2;
    }
  });
}
