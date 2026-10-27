import { Vector3, type Camera } from "three";

export interface StudyView {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

// Foundation lesson: slightly elevated side view, with the full pedestal and tool visible.
export const FOUNDATION_STUDY_VIEW: StudyView = {
  position: [120, 390, 1150],
  target: [160, 220, 0],
};

// 2-1 and 2-2: an oblique entry view of the robot and its XY work plane.
export const COORDINATE_STUDY_VIEW: StudyView = {
  position: [350, 980, 780] as const,
  target: [150, 230, 0] as const,
};

// 2-4: look down from the tool side so the drawing plane opens below the arm.
// Keep the fixed work area centered while learners enter P1, P2 and later points.
export const SHAPE_STUDY_VIEW: StudyView = {
  position: [760, 1130, 250],
  target: [185, 220, 0],
};

// FK/IK: a closer oblique view centered on the shoulder, elbow and tool.
export const KINEMATICS_STUDY_VIEW: StudyView = {
  position: [420, 560, 790],
  target: [180, 230, 0],
};

/** Preserve the preferred framing on tall panes without zooming in on wider panes. */
export function fitStudyView(view: StudyView, aspect: number, minimumAspect?: number): StudyView {
  const scale = minimumAspect ? Math.max(1, minimumAspect / Math.max(0.1, aspect)) : 1;
  if (scale === 1) return view;
  return { target: view.target, position: view.position.map((value, index) =>
    view.target[index] + (value - view.target[index]) * scale) as [number, number, number] };
}

/** Owns camera state only. Never reads or writes robot joints, coordinates or Home state. */
export class CoordinateViewSession {
  private readonly previousPosition: Vector3;
  private readonly previousTarget: Vector3;
  private readonly destination: Vector3;
  private readonly destinationTarget: Vector3;
  private moving = false;
  constructor(private camera: Camera, private target: Vector3, private update: () => void, view: StudyView = COORDINATE_STUDY_VIEW) {
    this.previousPosition = camera.position.clone();
    this.previousTarget = target.clone();
    this.destination = new Vector3(...view.position);
    this.destinationTarget = new Vector3(...view.target);
  }
  request() { this.moving = true; }
  cancel() { this.moving = false; }
  step(delta: number) {
    if (!this.moving) return;
    const alpha = 1 - Math.exp(-10 * Math.min(delta, 0.1));
    this.camera.position.lerp(this.destination, alpha);
    this.target.lerp(this.destinationTarget, alpha);
    if (this.camera.position.distanceTo(this.destination) < 0.5 && this.target.distanceTo(this.destinationTarget) < 0.5) {
      this.camera.position.copy(this.destination); this.target.copy(this.destinationTarget); this.cancel();
    }
    this.update();
  }
  restore() {
    this.cancel();
    this.camera.position.copy(this.previousPosition); this.target.copy(this.previousTarget); this.update();
  }
}

