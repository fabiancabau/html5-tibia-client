// Interpolation is presentation state only: a new floor/teleport must use the
// latest server position immediately, even if an earlier walk is still cached.
export function samePosition(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
}

export function creaturePose(creature, now) {
  const position = creature.position;
  const walk = creature.walk;
  const valid =
    walk &&
    samePosition(walk.to, position) &&
    walk.from.z === position.z &&
    walk.duration > 0 &&
    Math.max(
      Math.abs(walk.to.x - walk.from.x),
      Math.abs(walk.to.y - walk.from.y),
    ) === 1;
  if (!valid || now >= walk.start + walk.duration)
    return { position: { ...position }, walking: false, progress: 1 };
  const progress = Math.max(0, Math.min(1, (now - walk.start) / walk.duration));
  return {
    position: {
      x: walk.from.x + (walk.to.x - walk.from.x) * progress,
      y: walk.from.y + (walk.to.y - walk.from.y) * progress,
      z: position.z,
    },
    walking: true,
    progress,
  };
}

// Sprites extend north/west from their tile. Paint diagonals from the far corner
// to the near corner so tall scenery can correctly cover things behind it.
export function compareTileDepth(a, b) {
  return a.x + a.y - (b.x + b.y) || a.x - b.x;
}

export function creatureDepthPosition(
  creature,
  pose,
  displacement = { x: 0, y: 0 },
) {
  if (!pose.walking) return { ...creature.position };
  // Place a walking sprite in the scene by its visible feet, not by the tile
  // that already owns it on the server while it is still crossing the boundary.
  return {
    x: Math.floor(pose.position.x + (31 - displacement.x) / 32),
    y: Math.floor(pose.position.y + (31 - displacement.y) / 32),
    z: pose.position.z,
  };
}
