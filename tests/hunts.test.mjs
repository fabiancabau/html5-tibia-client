import test from "node:test";
import assert from "node:assert/strict";
import { Protocol76 } from "../yurots/protocol76.mjs";
import { Writer } from "../yurots/bytes.mjs";
const assets = {
  get: () => ({}),
  flag: () => false,
  hasSubtype: () => false,
  rank: () => 0,
};
const packet = (value) => new Writer(0xf0).u8(1).string(JSON.stringify(value));

test("hunt state is read from the server and stays aligned with following game packets", () => {
  const events = [],
    p = new Protocol76(assets, (type, data) => events.push([type, data]));
  assert.deepEqual(p.huntState, { active: false });
  const state = {
    event: "state",
    active: true,
    automatic: true,
    instance: 7,
    huntId: 239,
    kills: 2,
    experience: 100,
  };
  const w = packet(state).u8(0x78).u8(3).u16(2854);
  p.parse(w.data);
  assert.deepEqual(p.huntState, state);
  assert.equal(p.inventory.get(3).id, 2854);
  assert.equal(events[0][0], "hunt");
});
test("catalog/detail/error messages cannot replace active hunt authority", () => {
  const p = new Protocol76(assets);
  p.parse(packet({ event: "state", active: true, instance: 3 }).data);
  for (const data of [
    { event: "catalog", total: 247, next: 10, hunts: [] },
    { event: "detail", hunt: { id: 1 } },
    { event: "error", message: "Not in this party" },
  ])
    p.parse(packet(data).data);
  assert.equal(p.huntState.instance, 3);
  assert(p.huntState.active);
  p.parse(
    packet({ event: "state", active: false, message: "Hunt finished" }).data,
  );
  assert.equal(p.huntState.active, false);
});
test("unsupported or truncated hunt extensions fail visibly instead of misreading game data", () => {
  const p = new Protocol76(assets);
  assert.throws(
    () => p.parse(new Writer(0xf0).u8(2).string("{}").data),
    /Unknown hunt/,
  );
  assert.throws(
    () => p.parse(new Writer(0xf0).u8(1).u16(99).u8(123).data),
    /Truncated/,
  );
  assert.throws(() => p.parse(new Writer(0xf0).u8(1).string("{bad").data));
});
