import * as THREE from "three";

export const LINK5_TRANSITION_START_Z = -0.054;
export const LINK5_TRANSITION_END_Z = -0.062;
export const LINK5_CLEAN_UNDERSIDE_Z = -0.062;

const HOUSING = new THREE.Color("#c4c8cc");
const COLLAR = new THREE.Color("#343a40");

type Point = { x: number; y: number; z: number };

function intersectCut(a: Point, b: Point): Point {
  const t = (LINK5_CLEAN_UNDERSIDE_Z - a.z) / (b.z - a.z);
  return {
    x: THREE.MathUtils.lerp(a.x, b.x, t),
    y: THREE.MathUtils.lerp(a.y, b.y, t),
    z: LINK5_CLEAN_UNDERSIDE_Z,
  };
}

function clipTriangle(points: Point[]): Point[] {
  const clipped: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const aInside = a.z >= LINK5_CLEAN_UNDERSIDE_Z;
    const bInside = b.z >= LINK5_CLEAN_UNDERSIDE_Z;
    if (aInside) clipped.push(a);
    if (aInside !== bInside) clipped.push(intersectCut(a, b));
  }
  return clipped;
}

/**
 * Remove the non-functional square details below the wrist housing and return
 * a new, flat-ended display geometry. The source STL stays untouched, so its
 * J4 pivot and every kinematic/TCP value remain exactly as loaded.
 */
export function cleanLink5Silhouette(source: THREE.BufferGeometry) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const positions = geometry.getAttribute("position");
  const output: number[] = [];

  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;

  for (let i = 0; i + 2 < positions.count; i += 3) {
    const polygon = clipTriangle([0, 1, 2].map(offset => ({
      x: positions.getX(i + offset),
      y: positions.getY(i + offset),
      z: positions.getZ(i + offset),
    })));
    for (let j = 1; j + 1 < polygon.length; j++) {
      for (const point of [polygon[0], polygon[j], polygon[j + 1]]) {
        output.push(point.x, point.y, point.z);
      }
    }
  }

  // Clipping removes the original lower faces. Close that cut with a square
  // underside whose normal faces outward (-Z), so no camera angle can reveal
  // the housing interior. The on-axis shaft is rendered independently and
  // continues through this visual cover without changing its transform.
  if (bounds) {
    const { min, max } = bounds;
    const z = LINK5_CLEAN_UNDERSIDE_Z;
    output.push(
      min.x, min.y, z,
      min.x, max.y, z,
      max.x, max.y, z,
      min.x, min.y, z,
      max.x, max.y, z,
      max.x, min.y, z,
    );
  }

  const cleaned = new THREE.BufferGeometry();
  cleaned.setAttribute("position", new THREE.Float32BufferAttribute(output, 3));
  cleaned.computeVertexNormals();
  cleaned.computeBoundingBox();
  cleaned.computeBoundingSphere();
  return cleaned;
}

/** Add the real-product housing/collar finish to the cleaned display mesh. */
export function applyLink5Finish(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position");
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < positions.count; i++) {
    const z = positions.getZ(i);
    const blend = THREE.MathUtils.smoothstep(
      z,
      LINK5_TRANSITION_END_Z,
      LINK5_TRANSITION_START_Z,
    );
    color.copy(COLLAR).lerp(HOUSING, blend);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}
