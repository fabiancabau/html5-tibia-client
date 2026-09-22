// Match YurOTS' terrain/speed calculation. The server remains authoritative.
export function stepDuration(assets, tile, speed = 220) {
  const ground = tile?.things.find(
    (thing) => thing.kind === "item" && assets.flag(thing.id, "DatFlagGround"),
  );
  const groundSpeed = ground && assets.get(ground.id)?.properties?.speed;
  return groundSpeed > 0
    ? Math.max(1, Math.floor((1000 * groundSpeed) / (speed || 220)))
    : 500;
}

export const deltas = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
  northeast: [1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
  northwest: [-1, -1],
};

export class MovementController {
  constructor({ send, position, canStep, now = () => performance.now() }) {
    Object.assign(this, { send, position, canStep, now });
    this.reset();
  }
  clearInput() {
    this.held.clear();
    this.buffered = null;
  }
  clearPath() {
    this.path = [];
    this.resolvePath = null;
    this.pathVersion++;
  }
  stop(waitForCancel = false) {
    this.clearInput();
    this.clearPath();
    if (waitForCancel) this.stopping++;
  }
  reset() {
    this.held = new Map();
    this.pathVersion = 0;
    this.stopping = 0;
    this.stop();
    this.pending = null;
    this.nextAt = 0;
    this.rejected = null;
  }
  press(code, direction) {
    if (this.held.has(code)) return;
    this.clearPath();
    this.held.set(code, direction);
    // One latest intent survives a quick tap during the current step.
    this.buffered = direction;
  }
  release(code) {
    this.held.delete(code);
  }
  followPath(resolvePath) {
    this.stop();
    // Resolve after any in-flight step, from the server's updated position.
    this.resolvePath = resolvePath;
  }
  confirm(duration) {
    if (!this.pending) return;
    const { sentAt } = this.pending;
    this.pending = null;
    this.rejected = null;
    this.nextAt = sentAt + duration;
  }
  reject() {
    if (!this.pending) {
      // A rejected in-flight step arrives before an explicit stop's reply.
      // Only the latter consumes the stop barrier.
      if (this.stopping) this.stopping--;
      return;
    }
    const { direction, from, pathVersion } = this.pending;
    this.pending = null;
    // A dynamic blocker may disappear. Retry only this direction, without
    // delaying a turn away or flooding the server with rejected steps.
    this.rejected = { direction, from, until: this.now() + 150 };
    if (pathVersion === this.pathVersion) this.clearPath();
  }
  tick() {
    const now = this.now();
    if (this.pending || this.stopping || now < this.nextAt) return;
    const manual = this.buffered || [...this.held.values()].at(-1);
    if (!manual && this.resolvePath) {
      this.path = this.resolvePath();
      this.resolvePath = null;
    }
    const direction = manual || this.path[0];
    if (!direction) return;
    const from = this.position();
    if (!from) return;
    if (!this.canStep(direction, from)) {
      this.buffered = null;
      this.clearPath();
      return;
    }
    const rejected = this.rejected;
    if (
      rejected && rejected.direction === direction && now < rejected.until &&
      rejected.from.x === from.x && rejected.from.y === from.y && rejected.from.z === from.z
    )
      return;
    if (!this.send(direction)) return;
    this.pending = {
      direction, from: { ...from }, sentAt: now, pathVersion: this.pathVersion,
    };
    this.buffered = null;
    if (!manual) this.path.shift();
  }
}
