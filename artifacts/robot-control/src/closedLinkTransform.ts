import * as THREE from "three";

/** Places the existing metre-based link4_2 mesh between the live world pivots.
 * The link is outside the URDF's metre-to-millimetre group, but can still have
 * a translated/rotated cell robot as a parent. Keep its world construction
 * separate from that parent's local transform. */
export class ClosedLinkTransform {
  private readonly start = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly startRotation = new THREE.Quaternion();
  private readonly rotation = new THREE.Quaternion();
  private readonly worldMatrix = new THREE.Matrix4();
  private readonly parentInverse = new THREE.Matrix4();

  update(mesh: THREE.Object3D, startPivot: THREE.Object3D, endPivot: THREE.Object3D): void {
    startPivot.getWorldPosition(this.start);
    endPivot.getWorldPosition(this.end);
    startPivot.getWorldQuaternion(this.startRotation);
    this.normal.set(0, 1, 0).applyQuaternion(this.startRotation).normalize();

    // Mounting bores must share the pivot axes. Their centres may differ
    // along that axis, so remove only this axial difference from the span.
    this.direction.subVectors(this.end, this.start);
    this.direction.addScaledVector(this.normal, -this.direction.dot(this.normal));
    const length = this.direction.length();
    if (!Number.isFinite(length) || length < 0.001) {
      mesh.visible = false;
      return;
    }
    this.direction.normalize();
    this.yAxis.copy(this.normal).addScaledVector(this.direction, -this.normal.dot(this.direction)).normalize();
    this.zAxis.crossVectors(this.direction, this.yAxis).normalize();
    this.yAxis.crossVectors(this.zAxis, this.direction).normalize();
    this.worldMatrix.makeBasis(this.direction, this.yAxis, this.zAxis);
    this.rotation.setFromRotationMatrix(this.worldMatrix);

    // Preserve the original axial calibration: link4_2's 23.5 mm mid-plane
    // aligns with link4_1's 17 mm mid-plane. The STL bores are 0.175 m apart.
    this.position.copy(this.start).addScaledVector(this.normal,
      this.end.dot(this.normal) + (0.017 - 0.0235) * 1000 - this.start.dot(this.normal));
    this.scale.set(length / 0.175, 1000, 1000);
    this.worldMatrix.compose(this.position, this.rotation, this.scale);

    // A world transform must not be applied a second time by robot B's
    // translated, 180-degree parent. A matrix also preserves the exact
    // result under a scaled parent, where TRS decomposition can lose shear.
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this.worldMatrix);
    if (mesh.parent) {
      mesh.parent.updateWorldMatrix(true, false);
      this.parentInverse.copy(mesh.parent.matrixWorld).invert();
      mesh.matrix.premultiply(this.parentInverse);
    }
    mesh.matrixWorldNeedsUpdate = true;
    mesh.visible = true;
  }
}
