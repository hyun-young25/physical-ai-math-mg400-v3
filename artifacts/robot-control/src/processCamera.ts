import * as THREE from "three";
import type { CellScenario } from "./processCellTypes";
import type { LessonPose } from "./curriculum";

export type ProcessCameraScope = "work" | "whole" | "packing" | "frames";
export type ProcessCameraPreset = "free" | "top" | "side" | "front";
type V3 = [number, number, number];

/** Stable scene bounds, independent of the current robot/frame/selected question. */
export function processCameraBounds(scenario: CellScenario, scope: ProcessCameraScope, path: LessonPose[] = []): THREE.Box3 {
  const bounds = new THREE.Box3();
  const point = (x: number, y: number, z: number) => bounds.expandByPoint(new THREE.Vector3(x, z, -y));
  const surface = (x: number, y: number, z: number, halfX: number, halfY: number) => {
    for (const dx of [-halfX, halfX]) for (const dy of [-halfY, halfY]) {
      point(x + dx, y + dy, z - 32);
      // Include the held block, suction tool and approach at Z = 300 mm.
      point(x + dx, y + dy, Math.max(z + 115, 335));
    }
  };
  if (scope === "packing" && scenario.tray) {
    for (const cell of scenario.tray.points) {
      surface(cell.x, cell.y, cell.z, 70, 65);
      point(cell.x, cell.y, cell.z + 200);
    }
    return bounds;
  }
  if (scenario.belt) {
    const belt = scenario.belt;
    const dx = belt.to.x - belt.from.x, dy = belt.to.y - belt.from.y;
    const travel = Math.hypot(dx, dy);
    const ux = travel > 0 ? dx / travel : 0, uy = travel > 0 ? dy / travel : 1;
    const halfLength = Math.max(belt.length, travel + 65) / 2 + 8;
    const halfWidth = Math.max(60, belt.width) / 2 + 12;
    const x = (belt.from.x + belt.to.x) / 2, y = (belt.from.y + belt.to.y) / 2;
    for (const along of [-halfLength, halfLength]) for (const across of [-halfWidth, halfWidth]) {
      surface(x + ux * along - uy * across, y + uy * along + ux * across, belt.from.z, 0, 0);
    }
  } else surface(scenario.source.x, scenario.source.y, scenario.source.z, 50, 50);
  if (scenario.handoff) surface(scenario.handoff.x, scenario.handoff.y, scenario.handoff.z, 41, 41);
  if (scenario.tray) {
    for (const cell of scenario.tray.points) surface(cell.x, cell.y, cell.z, 35, 35);
  } else surface(scenario.destination.x, scenario.destination.y, scenario.destination.z, 50, 50);
  for (const robot of scenario.robots) {
    const yaw = robot.yaw * Math.PI / 180;
    const x = robot.origin.x + Math.cos(yaw) * robot.start.x - Math.sin(yaw) * robot.start.y;
    const y = robot.origin.y + Math.sin(yaw) * robot.start.x + Math.cos(yaw) * robot.start.y;
    point(x, y, robot.origin.z + robot.start.z + 40);
    if (scope === "work" && scenario.level === 4) {
      // Keep the two arms in context instead of filling the viewport with wrists.
      for (const dx of [-45, 45]) {
        point(robot.origin.x + dx, robot.origin.y, robot.origin.z + 40);
        point(robot.origin.x + dx, robot.origin.y, robot.origin.z + 500);
      }
    }
    if (scope === "whole" || scope === "frames") {
      for (const dx of [-115, 115]) for (const dy of [-115, 115]) {
        point(robot.origin.x + dx, robot.origin.y + dy, robot.origin.z);
        point(robot.origin.x + dx, robot.origin.y + dy, robot.origin.z + 520);
      }
      if (scope === "frames") {
        // Both local origins and positive axes belong in the coordinate comparison.
        for (const [localX, localY] of [[230, 0], [0, 230]]) {
          point(robot.origin.x + Math.cos(yaw) * localX - Math.sin(yaw) * localY,
            robot.origin.y + Math.sin(yaw) * localX + Math.cos(yaw) * localY, robot.origin.z);
        }
      }
    }
  }
  for (const p of path) {
    point(p.x - 25, p.y - 25, p.z - 25);
    point(p.x + 25, p.y + 25, p.z + 40);
  }
  if (scope === "whole") bounds.min.y = Math.min(0, bounds.min.y);
  return bounds;
}

export function processCameraFit(scenario: CellScenario, scope: ProcessCameraScope,
  preset: ProcessCameraPreset, aspect: number, fov = 41, path: LessonPose[] = []) {
  const bounds = processCameraBounds(scenario, scope, path);
  const target = bounds.getCenter(new THREE.Vector3());
  const offsets: Record<ProcessCameraPreset, V3> = {
    // Reference overviews show the robots from a low viewpoint; close-ups
    // stay elevated to reveal the work surfaces and paths.
    free: scope === "frames" ? [0.08, 1.45, 1] : scope === "packing" ? [0, 0.7, 1] : scenario.handoff ? (scope === "whole" ? [0, 0.32, 1] : scenario.level === 4 ? [0, 1.1, 1] : [0.08, 1.55, 1])
      : scenario.id.startsWith("pickplace-design-") ? [0.95, 1.1, 1.15]
      : scenario.level === 1 && scope === "whole" ? [1.08, 0.34, 1] : [0.85, 1.25, 0.55],
    top: [0, 1, 0.001], side: [1, 0.3, 0], front: [0, 0.28, 1],
  };
  const direction = new THREE.Vector3(...offsets[preset]).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
  const up = direction.clone().cross(right).normalize();
  const vertical = Math.tan(fov * Math.PI / 360) * 0.8;
  const horizontal = vertical * Math.max(0.1, aspect);
  let distance = 200;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
    for (const z of [bounds.min.z, bounds.max.z]) {
      const offset = new THREE.Vector3(x, y, z).sub(target);
      distance = Math.max(distance, offset.dot(direction) + Math.abs(offset.dot(right)) / horizontal,
        offset.dot(direction) + Math.abs(offset.dot(up)) / vertical);
    }
  }
  return { bounds, target: target.toArray() as V3,
    position: target.addScaledVector(direction, distance).toArray() as V3, distance };
}
