import test from "node:test";
import assert from "node:assert/strict";
import { Renderer76 } from "../yurots/renderer.mjs";
import { creaturePose, compareTileDepth } from "../yurots/render-state.mjs";
import { Protocol76, key } from "../yurots/protocol76.mjs";
import { Writer } from "../yurots/bytes.mjs";

function scene() {
  const rects = [];
  const ctx = {
    fillStyle: "",
    fillRect(x, y, w, h) {
      rects.push({ color: this.fillStyle, x, y, w, h });
    },
    strokeRect() {},
    strokeText() {},
    fillText() {},
  };
  const canvas = { width: 480, height: 352, getContext: () => ctx };
  const assets = {
    data: { itemCount: 1000 },
    get: (id) => ({
      properties: {},
      frameGroups: [{ animationLength: id === 1001 ? 3 : 1 }],
    }),
    flag: (id, flag) => id === 100 && flag === "DatFlagGround",
    rank: (id) => (id === 100 ? 0 : id === 200 ? 2 : 3),
    draw(ctx, id, x, y) {
      rects.push({
        color:
          id === 1001
            ? "creature"
            : id === 100
              ? "ground"
              : id === 200
                ? "wall"
                : "top",
        x,
        y,
        w: 32,
        h: 32,
      });
    },
  };
  // Avoid a browser-only ResizeObserver; the raster/render pipeline is real.
  const renderer = Object.assign(Object.create(Renderer76.prototype), {
    canvas,
    ctx,
    assets,
    effects: [],
    texts: [],
    missiles: [],
    view: { width: 480, height: 352, centerX: 7, centerY: 5 },
  });
  const protocol = {
    position: { x: 50, y: 50, z: 6 },
    playerId: 42,
    target: 0,
    tiles: new Map(),
  };
  const player = {
    kind: "creature",
    id: 42,
    name: "Test",
    health: 100,
    direction: 3,
    position: { ...protocol.position },
    outfit: { type: 1 },
  };
  protocol.player = player;
  for (let y = 47; y <= 53; y++)
    for (let x = 47; x <= 53; x++)
      protocol.tiles.set(key({ x, y, z: 6 }), {
        position: { x, y, z: 6 },
        things: [{ kind: "item", id: 100, count: 1 }],
      });
  const pixel = (x, y) =>
    rects.findLast(
      (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
    )?.color;
  return { rects, renderer, assets, protocol, player, pixel };
}

test("a crossing creature stays above both source and destination ground in all eight directions", () => {
  for (const [dx, dy] of [
    [-1, 0],
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const { renderer, protocol, player, pixel } = scene();
      const from = { x: 50, y: 50, z: 6 },
        to = { x: 50 + dx, y: 50 + dy, z: 6 };
      player.position = { ...to };
      protocol.position = { ...to };
      player.walk = { from, to, start: 1000, duration: 400 };
      protocol.tiles.get(key(to)).things.push(player);
      renderer.render(protocol, 1000 + 400 * fraction);
      // These points are inside the sprite body, below its name/health overlay.
      for (const x of [4, 16, 27])
        for (const y of [8, 20, 28])
          assert.equal(
            pixel(224 + x, 160 + y),
            "creature",
            `direction ${dx},${dy}, frame ${fraction}, pixel ${x},${y}`,
          );
    }
  }
});

test("foreground scenery still occludes creatures instead of drawing all actors on top of the map", () => {
  const { renderer, protocol, player, assets, pixel } = scene();
  protocol.tiles.get(key(player.position)).things.push(player);
  protocol.tiles
    .get("51,51,6")
    .things.push({ kind: "item", id: 200, count: 1 });
  const draw = assets.draw;
  assets.draw = (ctx, id, x, y) =>
    draw(ctx, id, id === 200 ? x - 32 : x, id === 200 ? y - 32 : y);
  renderer.render(protocol, 1000);
  assert.equal(pixel(240, 180), "wall");
});

test("ground on the floor above still covers a creature below it", () => {
  const { renderer, protocol, player, assets, pixel, rects } = scene();
  protocol.tiles.get(key(player.position)).things.push(player);
  // An upper-floor 64px roof extends west over the lower-floor creature.
  protocol.tiles.set("52,51,5", {
    position: { x: 52, y: 51, z: 5 },
    things: [{ kind: "item", id: 101, count: 1 }],
  });
  const rank = assets.rank,
    draw = assets.draw;
  assets.rank = (id) => (id === 101 ? 0 : rank(id));
  assets.draw = (ctx, id, x, y) =>
    id === 101
      ? rects.push({ color: "roof", x: x - 32, y, w: 64, h: 32 })
      : draw(ctx, id, x, y);
  renderer.render(protocol, 1000);
  assert.equal(pixel(240, 180), "roof");
});

test("stairs and teleports never reuse the previous floor walk for camera or actor position", () => {
  const { renderer, protocol, player } = scene();
  player.walk = {
    from: { x: 140, y: 73, z: 6 },
    to: { x: 141, y: 73, z: 6 },
    start: 1000,
    duration: 400,
  };
  player.position = { x: 141, y: 75, z: 7 };
  protocol.position = { ...player.position };
  for (const now of [1000, 1100, 1400, 3000]) {
    assert.deepEqual(creaturePose(player, now).position, player.position);
    assert.deepEqual(renderer.camera(protocol, now), protocol.position);
    assert.equal(creaturePose(player, now).walking, false);
  }
  player.walk = {
    from: { x: 140, y: 73, z: 7 },
    to: { x: 141, y: 73, z: 7 },
    start: 1000,
    duration: 400,
  };
  assert.deepEqual(
    renderer.camera(protocol, 1100),
    protocol.position,
    "same-floor teleport also snaps",
  );
});

test("full map updates clear all previous creature walks", () => {
  const p = new Protocol76({
    get: () => ({}),
    hasSubtype: () => false,
    rank: () => 0,
  });
  p.playerId = 42;
  p.creatures.set(42, {
    id: 42,
    walk: {
      from: { x: 141, y: 73, z: 6 },
      to: { x: 141, y: 74, z: 6 },
      start: 0,
      duration: 400,
    },
  });
  p.creatures.set(77, {
    id: 77,
    walk: {
      from: { x: 1, y: 1, z: 7 },
      to: { x: 2, y: 1, z: 7 },
      start: 0,
      duration: 400,
    },
  });
  const w = new Writer(0x64).pos({ x: 141, y: 75, z: 7 });
  let remaining = 18 * 14 * 8;
  while (remaining) {
    const count = Math.min(256, remaining);
    w.u16(0xff00 | (count - 1));
    remaining -= count;
  }
  p.parse(w.data);
  assert.equal(p.player.walk, undefined);
  assert.equal(p.creatures.get(77).walk, undefined);
  assert.deepEqual(p.position, { x: 141, y: 75, z: 7 });
});

test("tile depth follows north-west to south-east diagonals", () => {
  const positions = [
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 0 },
  ].sort(compareTileDepth);
  assert.deepEqual(positions, [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ]);
});
