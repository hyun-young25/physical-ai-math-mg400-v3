import type { Material, Mesh, Object3D } from "three";

/** Instance-local display treatment. Never changes geometry, transforms or shared materials. */
export function softenPaperRobot(root: Object3D) {
  const copies = new Map<Material, Material>();
  const restore: (() => void)[] = [];
  const soften = (original: Material) => {
    let copy = copies.get(original);
    if (!copy) {
      copy = original.clone();
      copy.transparent = true;
      copy.opacity = Math.min(original.opacity, 0.18);
      copy.depthWrite = false;
      copies.set(original, copy);
    }
    return copy;
  };
  root.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const { material, castShadow, receiveShadow } = mesh;
    mesh.material = Array.isArray(material) ? material.map(soften) : soften(material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    restore.push(() => { mesh.material = material; mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow; });
  });
  return () => { restore.forEach(fn => fn()); copies.forEach(material => material.dispose()); };
}
