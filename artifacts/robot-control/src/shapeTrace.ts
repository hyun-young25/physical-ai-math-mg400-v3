type WorldPoint = readonly [number, number, number];

/** Samples the physical pen, then seals the stroke at its measured drawing endpoint. */
export class ShapeTraceBuffer {
  readonly positions: Float32Array;
  readonly floorPositions: Float32Array;
  count = 0;
  private finalized = false;

  constructor(private capacity = 8000) {
    this.positions = new Float32Array(capacity * 3);
    this.floorPositions = new Float32Array(capacity * 3);
  }

  reset() { this.count = 0; this.finalized = false; }

  sample(physicalTip: WorldPoint | null, active: boolean, measuredEndpoint?: WorldPoint | null): boolean {
    if (this.finalized) return false;
    const final = !active && !!measuredEndpoint;
    const point = final ? measuredEndpoint! : active ? physicalTip : null;
    if (!point || !point.every(Number.isFinite)) return false;
    if (this.count && !final) {
      const offset = (this.count - 1) * 3;
      const distanceSquared = point.reduce((sum, value, axis) => sum + (value - this.positions[offset + axis]) ** 2, 0);
      if (distanceSquared < 4) return false;
    }
    if (this.count >= this.capacity && !final) return false;
    const index = Math.min(this.count, this.capacity - 1) * 3;
    this.positions.set(point, index);
    this.floorPositions.set([point[0], 2, point[2]], index);
    this.count = Math.min(this.count + 1, this.capacity);
    this.finalized = final;
    return true;
  }
}
