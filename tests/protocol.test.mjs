import test from "node:test";
import assert from "node:assert/strict";
import {
  Reader,
  Writer,
  loginPacket,
  gamePacket,
  readLogin,
} from "../yurots/bytes.mjs";
import { Protocol76, key } from "../yurots/protocol76.mjs";
import { Framer, frame } from "../gateway/framing.mjs";
const assets = {
  get: (id) => (id >= 100 ? {} : null),
  hasSubtype: (id) => id === 200,
  rank: (id) => (id === 100 ? 0 : 5),
};
test("TCP fragments and coalesced packets preserve message boundaries", () => {
  const packets = [],
    f = new Framer((p) => packets.push([...p]));
  const bytes = Buffer.concat([
    frame(Buffer.from([0x65])),
    frame(Buffer.from([0x96, 1, 2, 3])),
  ]);
  for (const byte of bytes) f.push(Buffer.from([byte]));
  assert.deepEqual(packets, [[0x65], [0x96, 1, 2, 3]]);
  assert.equal(f.pending.length, 0);
});
test("reject invalid lengths and truncated reads", () => {
  assert.throws(() => new Framer(() => {}).push(Buffer.from([0, 0])));
  assert.throws(() => frame(Buffer.alloc(0)));
  assert.throws(() => new Reader([1]).u16(), /Truncated/);
  assert.throws(() => new Reader([3, 0, 65]).string(), /Truncated/);
});
test("7.6 login and game handshakes match YurOTS byte offsets", () => {
  const login = new Reader(loginPacket(111111, "tibia"));
  assert.equal(login.u16(), 0x0201);
  for (let i = 0; i < 15; i++) login.u8();
  assert.equal(login.u32(), 111111);
  assert.equal(login.string(), "tibia");
  const game = new Reader(gamePacket(111111, "tibia", "Yurez"));
  assert.equal(game.u16(), 0x020a);
  assert.equal(game.u8(), 0);
  assert.equal(game.u16(), 760);
  assert.equal(game.u8(), 0);
  assert.equal(game.u32(), 111111);
  assert.equal(game.string(), "Yurez");
  assert.equal(game.string(), "tibia");
});
test("login success, rejection and Latin-1", () => {
  const packet = new Writer(20)
    .string("0\nWelcome")
    .u8(100)
    .u8(1)
    .string("Yurez")
    .string("YurOTS")
    .u32(0x0100007f)
    .u16(7171)
    .u16(90);
  assert.equal(readLogin(packet.data).characters[0].name, "Yurez");
  assert.throws(
    () => readLogin(new Writer(10).string("Bad password").data),
    /Bad password/,
  );
  assert.equal(new Reader(new Writer().string("ação").data).string(), "ação");
});
test("map skip runs cross floor boundaries and clear old cells", () => {
  const p = new Protocol76(assets);
  const w = new Writer();
  w.u16(100).u16(0xff02);
  for (let i = 0; i < 7; i++) w.u16(0xff02);
  p.map(new Reader(w.data), 10, 20, 7, 3, 1);
  assert.equal(p.tiles.size, 24);
  assert.equal(p.tiles.get("10,20,7").things[0].id, 100);
  assert.equal(p.tiles.get("11,20,7").things.length, 0);
  assert.equal(p.tiles.get("19,27,0").things.length, 0);
});
test("subtype counts are conditional and inventory packets stay aligned", () => {
  const p = new Protocol76(assets);
  p.parse(
    new Writer(0x78)
      .u8(1)
      .u16(100)
      .u8(0x78)
      .u8(2)
      .u16(200)
      .u8(87)
      .u8(0x79)
      .u8(3).data,
  );
  assert.deepEqual(p.inventory.get(2), { kind: "item", id: 200, count: 87 });
  assert.equal(p.inventory.get(1).count, 1);
  assert.equal(p.inventory.has(3), false);
});
test("self movement followed by a strip moves once and maps at the right origin", () => {
  const p = new Protocol76(assets),
    from = { x: 50, y: 50, z: 7 };
  p.position = from;
  p.playerId = 42;
  const c = {
    kind: "creature",
    id: 42,
    name: "Test",
    speed: 220,
    position: from,
  };
  p.creatures.set(42, c);
  p.setTile(from, [{ kind: "item", id: 100, count: 1 }, c]);
  const w = new Writer(0x6d)
    .pos(from)
    .u8(1)
    .pos({ x: 51, y: 50, z: 7 })
    .u8(0x66);
  for (let z = 7; z >= 0; z--) w.u16(100).u16(0xff0d);
  p.parse(w.data);
  assert.deepEqual(p.position, { x: 51, y: 50, z: 7 });
  assert.equal(p.tiles.get("60,44,7").things[0].id, 100);
  assert.equal(p.tiles.get(key(from)).things.length, 1);
});
test("container mutations and health updates", () => {
  const p = new Protocol76(assets);
  p.creatures.set(10, { kind: "creature", id: 10, health: 100 });
  p.parse(
    new Writer(0x6e)
      .u8(0)
      .u16(100)
      .string("Bag")
      .u8(8)
      .u8(0)
      .u8(1)
      .u16(200)
      .u8(50)
      .u8(0x70)
      .u8(0)
      .u16(100)
      .u8(0x72)
      .u8(0)
      .u8(1)
      .u8(0x8c)
      .u32(10)
      .u8(60).data,
  );
  assert.equal(p.containers.get(0).items.length, 1);
  assert.equal(p.containers.get(0).items[0].id, 100);
  assert.equal(p.creatures.get(10).health, 60);
});
test("unknown opcodes and unknown assets fail visibly instead of corrupting state", () => {
  const p = new Protocol76(assets);
  assert.throws(() => p.parse([0xff]), /Unsupported/);
  assert.throws(() => p.thing(new Reader([50, 0])), /Missing/);
});
