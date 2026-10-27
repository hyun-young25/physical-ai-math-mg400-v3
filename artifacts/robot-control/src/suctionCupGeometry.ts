import * as THREE from "three";

// Flat, asymmetric paint marks make wrist rotation readable without adding a
// protruding direction block. These are teaching markings, not real moulding.
export const SUCTION_MARKS = [
  { center: 0.06, width: 0.16, color: [30, 58, 138] },
  { center: 0.38, width: 0.075, color: [37, 99, 235] },
  { center: 0.73, width: 0.12, color: [56, 189, 248] },
] as const;
const BODY = [208, 208, 206] as const;

export function suctionSurfaceColor(u: number): readonly number[] {
  for (const mark of SUCTION_MARKS) {
    const distance = Math.abs(((u - mark.center + 1.5) % 1) - 0.5);
    if (distance < mark.width / 2) return mark.color;
  }
  return BODY;
}

export function createSuctionCupTexture() {
  const width = 512, height = 4, data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = suctionSurfaceColor((x + 0.5) / width), i = (y * width + x) * 4;
    data.set([...color, 255], i);
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Preserve the original vertices, caps, UVs and dimensions in J4-local metres.
export function createSuctionCupGeometry(topRadius:number,bottomRadius:number,height:number,segments:number) {
  const source = new THREE.CylinderGeometry(topRadius, bottomRadius, height, segments);
  const geometry = source.toNonIndexed();
  source.dispose();
  return geometry;
}

export function createSuctionCup() {
  const cup = new THREE.Group();
  cup.name = "suction-cup-surface";
  const side = new THREE.MeshStandardMaterial({ map: createSuctionCupTexture(), roughness: 0.72, metalness: 0.04 });
  const cap = new THREE.MeshStandardMaterial({ color: "#d0d0ce", roughness: 0.72, metalness: 0.04 });
  // CylinderGeometry uses material groups 0 (side), 1 (top), 2 (bottom).
  const materials = [side, cap, cap];
  // The mount is required to connect the wrist and suction skirt. More radial
  // segments remove the box-like silhouette while retaining every dimension,
  // centre line and TCP-relative position.
  const parts = [
    { name: "mount", top: 0.0101, bottom: 0.0101, height: 0.014, z: -0.102, segments: 32 },
    { name: "skirt", top: 0.0101, bottom: 0.0135, height: 0.010, z: -0.114, segments: 32 },
    { name: "lip", top: 0.0135, bottom: 0.0135, height: 0.002, z: -0.120, segments: 48 },
  ];
  for (const p of parts) {
    const mesh = new THREE.Mesh(createSuctionCupGeometry(p.top, p.bottom, p.height, p.segments), materials);
    mesh.name = `suction-${p.name}`;
    mesh.position.z = p.z;
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cup.add(mesh);
  }
  return cup;
}

export function disposeSuctionCup(cup:THREE.Group) {
  const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  cup.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      if (material instanceof THREE.MeshStandardMaterial && material.map) textures.add(material.map);
    }
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
}
