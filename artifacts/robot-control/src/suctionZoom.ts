import * as THREE from "three";

type Rect = { left:number; top:number; width:number; height:number };
export type ZoomViewport = { x:number; y:number; width:number; height:number };

// Renderer viewport units are logical pixels; WebGLRenderer applies DPR itself.
export function suctionZoomViewport(canvas:Rect, slot:Rect, size:{x:number;y:number}):ZoomViewport|null {
  if (canvas.width <= 0 || canvas.height <= 0 || slot.width <= 0 || slot.height <= 0) return null;
  if (slot.left + slot.width <= canvas.left || slot.left >= canvas.left + canvas.width
    || slot.top + slot.height <= canvas.top || slot.top >= canvas.top + canvas.height) return null;
  return {
    x: (slot.left - canvas.left) * size.x / canvas.width,
    y: (canvas.top + canvas.height - slot.top - slot.height) * size.y / canvas.height,
    width: slot.width * size.x / canvas.width,
    height: slot.height * size.y / canvas.height,
  };
}

export class SuctionZoomView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-0.027, 0.027, 0.020, -0.020, 0.001, 2);
  readonly rotation = new THREE.Group();
  private source:THREE.Group|null = null;

  constructor() {
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2; // Same URDF-to-world orientation as the main robot.
    root.add(this.rotation);
    this.scene.add(root, new THREE.AmbientLight("#ffffff", 1.2));
    const light = new THREE.DirectionalLight("#ffffff", 2);
    light.position.set(0.1, 0.2, 0.2);
    this.scene.add(light);
    this.camera.position.set(0.11, -0.068, 0.17);
    this.camera.lookAt(0, -0.108, 0);
  }

  sync(source:THREE.Group):number|null {
    if (!source.parent) return null;
    if (source !== this.source) {
      this.rotation.clear();
      // Clone transforms only. Geometry/material/texture are the actual cup's resources.
      // The clone never reparents or disposes anything in the robot scene.
      this.rotation.add(source.clone(true));
      this.source = source;
    }
    this.rotation.quaternion.copy(source.parent.quaternion);
    return THREE.MathUtils.radToDeg(source.parent.rotation.z);
  }

  release() {
    this.rotation.clear();
    this.source = null;
  }
}

// One shared WebGL context. Restore every state changed by the inset, including on error.
export function drawSuctionZoom(renderer:THREE.WebGLRenderer, view:SuctionZoomView, rect:ZoomViewport) {
  const viewport = renderer.getViewport(new THREE.Vector4());
  const scissor = renderer.getScissor(new THREE.Vector4());
  const scissorTest = renderer.getScissorTest();
  const color = renderer.getClearColor(new THREE.Color()).clone(), alpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear, shadowAutoUpdate = renderer.shadowMap.autoUpdate;
  try {
    const aspect = rect.width / rect.height;
    const halfHeight = Math.max(0.020, 0.018 / aspect);
    view.camera.top = halfHeight;
    view.camera.bottom = -halfHeight;
    view.camera.left = -halfHeight * aspect;
    view.camera.right = halfHeight * aspect;
    view.camera.updateProjectionMatrix();
    renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
    renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
    renderer.setScissorTest(true);
    renderer.setClearColor("#edf1f4", 1);
    renderer.autoClear = true;
    renderer.shadowMap.autoUpdate = false;
    renderer.render(view.scene, view.camera);
  } finally {
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(scissorTest);
    renderer.setClearColor(color, alpha);
    renderer.autoClear = autoClear;
    renderer.shadowMap.autoUpdate = shadowAutoUpdate;
  }
}
