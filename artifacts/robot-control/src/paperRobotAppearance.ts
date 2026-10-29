import type { Color, Material, Mesh, Object3D } from "three";

/** Instance-local display treatment. Never changes geometry, transforms or shared materials. */
export function softenPaperRobot(root: Object3D) {
  const copies = new Map<Material, Material>();
  const tracked = new Map<Mesh, { original: Material | Material[]; shown: Material | Material[]; castShadow: boolean; receiveShadow: boolean }>();
  const soften = (original: Material) => {
    let copy = copies.get(original);
    if (!copy) {
      copy = original.clone();
      copy.transparent = true;
      copy.opacity = Math.min(original.opacity, 0.32);
      (copy as Material & { color?: Color }).color?.set("#8b98a6");
      (copy as Material & { vertexColors?: boolean }).vertexColors = false;
      copy.depthWrite = false;
      copies.set(original, copy);
    }
    return copy;
  };
  const refresh = () => {
    const used = new Set<Material>();
    root.traverse(object => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      let record = tracked.get(mesh);
      if (!record) { record = {original:mesh.material,shown:mesh.material,castShadow:mesh.castShadow,receiveShadow:mesh.receiveShadow}; tracked.set(mesh,record); }
      // Some existing tool meshes replace their material on React renders.
      if (mesh.material !== record.shown) record.original = mesh.material;
      const originals = Array.isArray(record.original) ? record.original : [record.original];
      originals.forEach(material => used.add(material));
      record.shown = Array.isArray(record.original) ? originals.map(soften) : soften(record.original);
      mesh.material = record.shown; mesh.castShadow = false; mesh.receiveShadow = false;
    });
    copies.forEach((copy,original) => { if (!used.has(original)) { copy.dispose(); copies.delete(original); } });
  };
  refresh();
  return Object.assign(() => {
    tracked.forEach((record,mesh) => {
      if (mesh.material === record.shown) mesh.material = record.original;
      mesh.castShadow = record.castShadow; mesh.receiveShadow = record.receiveShadow;
    });
    copies.forEach(material => material.dispose());
  }, { refresh });
}

/** A display-only snapshot. Geometry is shared; transforms and materials are not.
 * Keep the last current pose before DT starts, then freeze it while the existing
 * animated model becomes the grey preview. No joint, TCP or execution state is set.
 */
export function createPaperRobotPreview(source: Object3D) {
  const current = source.clone(true);
  current.name = "paper-current-position";
  current.visible = false;
  const sources: Object3D[] = [], copies: Object3D[] = [];
  source.traverse(object => sources.push(object));
  current.traverse(object => copies.push(object));
  const materials = new Map<Material, Material>();
  const copyMaterial = (material: Material) => {
    let copy = materials.get(material);
    if (!copy) { copy = material.clone(); materials.set(material, copy); }
    return copy;
  };
  current.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copyMaterial) : copyMaterial(mesh.material);
    // The frozen reference is never an interactive robot or a second controller.
    mesh.raycast = () => {};
  });
  const originalVisible = source.visible;
  let frozen = false, restore: ReturnType<typeof softenPaperRobot> | undefined;
  return {
    current,
    get frozen() { return frozen; },
    syncCurrent() {
      if (frozen) return;
      sources.forEach((object, i) => {
        const copy = copies[i];
        copy.position.copy(object.position); copy.quaternion.copy(object.quaternion); copy.scale.copy(object.scale);
        copy.matrix.copy(object.matrix); copy.matrixAutoUpdate = object.matrixAutoUpdate;
        if (i) copy.visible = object.visible;
      });
    },
    showPreview(visible: boolean) {
      if (!frozen && visible) { frozen = true; restore = softenPaperRobot(source); }
      if (visible) restore?.refresh();
      current.visible = frozen;
      source.visible = frozen ? visible : originalVisible;
    },
    dispose() {
      restore?.(); source.visible = originalVisible;
      current.removeFromParent(); materials.forEach(material => material.dispose());
    },
  };
}
