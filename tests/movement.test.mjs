import test from "node:test";
import assert from "node:assert/strict";
import { MovementController, stepDuration } from "../yurots/movement.mjs";
import { Protocol76 } from "../yurots/protocol76.mjs";
import { Writer } from "../yurots/bytes.mjs";

function fixture() {
  let now = 0, position = { x: 10, y: 10, z: 7 };
  const sent = [], blocked = new Set();
  const movement = new MovementController({
    now: () => now,
    position: () => position,
    canStep: (direction) => !blocked.has(direction),
    send: (direction) => { sent.push(direction); return true; },
  });
  return { movement, sent, blocked,
    tick(time) { now = time; movement.tick(); },
    position(value) { position = value; },
    tap(direction) { movement.press(direction, direction); movement.release(direction); },
  };
}

test("a wall does not send a move or add a cooldown to the next direction", () => {
  const f = fixture();
  f.blocked.add("north");
  f.movement.press("up", "north");
  f.tick(0);
  f.tick(100);
  assert.deepEqual(f.sent, []);
  f.movement.press("right", "east");
  f.tick(101);
  assert.deepEqual(f.sent, ["east"]);
});

test("newest held direction wins, key repeat cannot steal it, release restores the older key", () => {
  const f = fixture();
  f.movement.press("up", "north");
  f.tick(0);
  f.movement.press("right", "east");
  f.movement.press("up", "north");
  f.movement.confirm(400);
  f.tick(399);
  assert.deepEqual(f.sent, ["north"]);
  f.tick(400);
  assert.deepEqual(f.sent, ["north", "east"]);
  f.movement.release("right");
  f.movement.confirm(400);
  f.tick(800);
  assert.deepEqual(f.sent, ["north", "east", "north"]);
});

test("quick turns during a step keep only the latest tap, with no trailing queue", () => {
  const f = fixture();
  f.tap("north");
  f.tick(0);
  f.tap("east");
  f.tap("south");
  f.tick(200);
  f.movement.confirm(400);
  f.tick(400);
  f.movement.confirm(400);
  f.tick(800);
  assert.deepEqual(f.sent, ["north", "south"]);
});

test("a missing reply never unlocks an in-flight request, even after old timeout deadlines", () => {
  const f = fixture();
  f.movement.press("up", "north");
  f.tick(0);
  f.movement.confirm(400);
  f.tick(400);
  f.tap("east");
  for (const t of [1000, 1400, 5000, 60000]) f.tick(t);
  assert.deepEqual(f.sent, ["north", "north"]);
  f.movement.confirm(400);
  f.tick(60001);
  assert.deepEqual(f.sent, ["north", "north", "east"]);
});

test("a rejected move immediately accepts a buffered turn and does not charge a step", () => {
  const f = fixture();
  f.movement.press("up", "north");
  f.tick(0);
  f.tap("east");
  f.tick(25);
  f.movement.reject();
  f.tick(26);
  assert.deepEqual(f.sent, ["north", "east"]);
});

test("a held direction retries dynamic blockers at a bounded rate", () => {
  const f = fixture();
  f.movement.press("up", "north");
  f.tick(0);
  f.movement.reject();
  f.tick(149);
  assert.equal(f.sent.length, 1);
  f.tick(150);
  assert.equal(f.sent.length, 2);
});

test("releasing a key stops repeat walking after its committed step", () => {
  const f = fixture();
  f.movement.press("up", "north");
  f.tick(0);
  f.movement.release("up");
  f.movement.confirm(400);
  f.tick(1000);
  assert.deepEqual(f.sent, ["north"]);
});

test("click paths resolve from the acknowledged position and manual input cancels them", () => {
  const f = fixture();
  let planned = 0;
  f.tap("north");
  f.tick(0);
  f.movement.followPath(() => { planned++; return ["east", "east"]; });
  f.tick(200);
  assert.equal(planned, 0);
  f.position({ x: 10, y: 9, z: 7 });
  f.movement.confirm(400);
  f.tick(400);
  assert.equal(planned, 1);
  assert.deepEqual(f.movement.pending.from, { x: 10, y: 9, z: 7 });
  f.tap("south");
  f.movement.confirm(400);
  f.tick(800);
  f.movement.confirm(400);
  f.tick(1200);
  assert.deepEqual(f.sent, ["north", "east", "south"]);
});

test("a stale path rejection does not erase a newer click destination", () => {
  const f = fixture();
  f.movement.followPath(() => ["north", "north"]);
  f.tick(0);
  f.movement.followPath(() => ["east"]);
  f.movement.reject();
  f.tick(1);
  assert.deepEqual(f.sent, ["north", "east"]);
});

test("a blocked path stops instead of skipping the rejected step", () => {
  const f = fixture();
  f.movement.followPath(() => ["north", "east"]);
  f.tick(0);
  f.movement.reject();
  f.tick(1000);
  assert.deepEqual(f.sent, ["north"]);
});

test("blur clears held keys, buffered taps and paths without unlocking the pending move", () => {
  const f = fixture();
  f.movement.press("up", "north");
  f.tick(0);
  f.tap("east");
  f.movement.stop();
  f.tick(2000);
  assert.equal(f.movement.pending.direction, "north");
  f.movement.confirm(400);
  f.tick(2001);
  assert.deepEqual(f.sent, ["north"]);
});

test("Escape waits for cancellation before sending a fresh turn", () => {
  const f = fixture();
  f.tap("north");
  f.tick(0);
  f.movement.stop(true);
  f.movement.stop(true);
  f.tap("east");
  f.movement.confirm(400);
  f.tick(500);
  f.movement.reject();
  f.tick(501);
  assert.deepEqual(f.sent, ["north"]);
  f.movement.reject();
  f.tick(502);
  assert.deepEqual(f.sent, ["north", "east"]);
});

test("disconnect resets timing and buffered state for a new character", () => {
  const f = fixture();
  f.tap("north");
  f.tick(0);
  f.movement.stop(true);
  f.movement.reset();
  f.tap("west");
  f.tick(1);
  assert.deepEqual(f.sent, ["north", "west"]);
});

test("a rejected step before Escape does not consume Escape's own cancellation reply", () => {
  const f = fixture();
  f.tap("north");
  f.tick(0);
  f.movement.stop(true);
  f.tap("east");
  f.movement.reject();
  f.tick(1);
  assert.deepEqual(f.sent, ["north"]);
  f.movement.reject();
  f.tick(2);
  assert.deepEqual(f.sent, ["north", "east"]);
});

const assets = {
  flag: (id, flag) => id === 100 && flag === "DatFlagGround",
  get: () => ({ properties: { speed: 150 } }),
  rank: (id) => id === 100 ? 0 : 5,
};
test("terrain pacing uses server integer timing, speed changes and fallback", () => {
  const tile = { things: [{ kind: "item", id: 100 }] };
  assert.equal(stepDuration(assets, tile, 290), 517);
  assert.equal(stepDuration(assets, tile, 580), 258);
  assert.equal(stepDuration(assets, tile, 0), 681);
  assert.equal(stepDuration(assets, undefined, 290), 500);
});

test("authoritative diagonal animation covers its full terrain-dependent interval", () => {
  const p = new Protocol76(assets), from = { x: 10, y: 10, z: 7 }, to = { x: 11, y: 9, z: 7 };
  const player = { kind: "creature", id: 42, speed: 290, position: from };
  p.playerId = 42;
  p.position = from;
  p.creatures.set(42, player);
  p.setTile(from, [{ kind: "item", id: 100 }, player]);
  p.setTile(to, [{ kind: "item", id: 100 }]);
  p.parse(new Writer(0x6d).pos(from).u8(1).pos(to).data);
  assert.equal(player.walk.duration, 1034);
  assert.deepEqual(p.position, to);
});
