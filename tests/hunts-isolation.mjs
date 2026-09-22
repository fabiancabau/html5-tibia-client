import { chromium } from "playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true }),
  pages = [],
  errors = [],
  out = new URL("../artifacts/hunt-isolation/", import.meta.url);
await mkdir(out, { recursive: true });
const base = process.env.CLIENT_URL || "http://127.0.0.1:8084";
async function login(name) {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  pages.push(p);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForFunction(() => yurots.assets.loaded);
  await p.fill("#account", "111111");
  await p.fill("#password", "tibia");
  await p.click("#login");
  await p
    .getByRole("button", { name: `${name} · YurOTS`, exact: true })
    .click();
  await p.waitForFunction(() => yurots.protocol?.position);
  await p.evaluate(() => {
    window.huntEvents = [];
    const original = yurots.protocol.emit;
    yurots.protocol.emit = (type, data) => {
      if (type === "hunt") huntEvents.push(data);
      original(type, data);
    };
  });
  return p;
}
async function send(p, action, id) {
  await p.evaluate(
    async ({ action, id }) => {
      const { Writer } = await import("/yurots/bytes.mjs");
      const w = new Writer(0xf0).u8(action);
      if (id !== undefined) w.u16(id);
      yurots.send(w);
    },
    { action, id },
  );
}
async function say(p, text) {
  await p.fill("#chat-input", text);
  await p.locator("#chat-form button").click();
}
async function catalog(p) {
  await p.click("#hunts");
  await p.waitForFunction(() => yurots.huntUI.catalog.length === 247);
  const id = await p.evaluate(
    () =>
      yurots.huntUI.catalog.find(
        (h) => h.monsters.every((m) => m.name === "Rat") && h.spawns >= 3,
      ).id,
  );
  await p.click("#hunt-close");
  return id;
}
async function start(p, id) {
  await p.evaluate(async (id) => {
    const { Writer } = await import("/yurots/bytes.mjs");
    yurots.send(new Writer(0xf0).u8(1).u16(id).u8(0).u8(1));
  }, id);
  await p.waitForFunction(() => yurots.protocol.huntState.active);
  return p.evaluate(() => ({
    pos: structuredClone(yurots.protocol.position),
    ...yurots.protocol.huntState,
  }));
}
async function leave(p) {
  await p.waitForTimeout(300);
  await p.click("#hunt-leave");
  await p.waitForFunction(() => !yurots.protocol.huntState.active);
}
async function diagnostics(gm) {
  await gm.evaluate(() => (window.huntEvents = []));
  await send(gm, 7);
  await gm.waitForFunction(() =>
    huntEvents.some((e) => e.event === "diagnostics"),
  );
  return gm.evaluate(() => huntEvents.find((e) => e.event === "diagnostics"));
}
const result = {};
try {
  const a = await login("Yurez The Next"),
    b = await login("Yurez"),
    gm = await login("GM Yurez");
  const id = await catalog(a);
  await catalog(b);
  const originalA = await a.evaluate(() =>
      structuredClone(yurots.protocol.position),
    ),
    originalB = await b.evaluate(() =>
      structuredClone(yurots.protocol.position),
    );
  const first = await start(a, id),
    second = await start(b, id);
  assert.notEqual(first.instance, second.instance);
  assert(
    Math.abs(first.pos.x - second.pos.x) >= 400 ||
      Math.abs(first.pos.y - second.pos.y) >= 400,
  );
  await a.waitForFunction(() => yurots.protocol.huntState.alive > 0);
  await b.waitForFunction(() => yurots.protocol.huntState.alive > 0);
  const seenA = await a.evaluate(
      () => JSON.parse(render_game_to_text()).creatures,
    ),
    seenB = await b.evaluate(() => JSON.parse(render_game_to_text()).creatures);
  assert(!seenA.some((c) => c.name === "Yurez"));
  assert(!seenB.some((c) => c.name === "Yurez The Next"));
  assert(!seenA.some((c) => seenB.some((d) => d.id === c.id)));
  result.separate = { a: first, b: second, diagnostics: await diagnostics(gm) };
  assert.equal(result.separate.diagnostics.instances, 2);
  const gmOrigin = await gm.evaluate(() =>
    structuredClone(yurots.protocol.position),
  );
  await say(gm, `/send GM Yurez,${first.pos.x} ${first.pos.y} ${first.pos.z}`);
  await gm.waitForTimeout(300);
  assert.deepEqual(await gm.evaluate(() => yurots.protocol.position), gmOrigin);
  await say(gm, "/save");
  await gm.waitForTimeout(400);
  const saved = execFileSync(
    "docker",
    [
      "exec",
      process.env.HUNT_TEST_CONTAINER || "yurots-hunts-test",
      "cat",
      "data/players/yurez the next.xml",
    ],
    { encoding: "utf8" },
  );
  const spawn = saved.match(/<spawn x="(\d+)" y="(\d+)" z="(\d+)"/);
  assert(spawn);
  assert.deepEqual({ x: +spawn[1], y: +spawn[2], z: +spawn[3] }, originalA);
  result.safeAutosave = true;
  result.outsiderBlocked = true;
  await leave(a);
  await leave(b);
  await gm.waitForTimeout(1500);
  result.cleanup = await diagnostics(gm);
  assert.equal(result.cleanup.instances, 0);
  assert.equal(result.cleanup.tiles, 0);
  // Form the party in the public world, then explicitly join the same private hunt.
  await say(gm, "/send Yurez,125 59 7");
  await b.waitForFunction(
    () =>
      yurots.protocol.position.x === 125 && yurots.protocol.position.y === 59,
  );
  const aid = await a.evaluate(() => yurots.protocol.playerId),
    bid = await b.evaluate(() => yurots.protocol.playerId);
  await a.evaluate(async (id) => {
    const { Writer } = await import("/yurots/bytes.mjs");
    yurots.send(new Writer(0xa3).u32(id));
  }, bid);
  await b.waitForFunction(() =>
    JSON.parse(render_game_to_text()).messages.some((m) =>
      m.includes("invites you"),
    ),
  );
  await b.evaluate(async (id) => {
    const { Writer } = await import("/yurots/bytes.mjs");
    yurots.send(new Writer(0xa4).u32(id));
  }, aid);
  await b.waitForFunction(() =>
    JSON.parse(render_game_to_text()).messages.some((m) =>
      m.includes("joined"),
    ),
  );
  const partyA = await start(a, id),
    partyB = await start(b, id);
  assert.equal(partyA.instance, partyB.instance);
  await a.waitForFunction(() => yurots.protocol.huntState.members === 2);
  result.party = {
    instance: partyA.instance,
    diagnostics: await diagnostics(gm),
  };
  assert.equal(result.party.diagnostics.instances, 1);
  assert.equal(result.party.diagnostics.members, 2);
  await b.close();
  await gm.waitForTimeout(700);
  await a.waitForFunction(() => yurots.protocol.huntState.members === 1);
  result.disconnectedMemberRemoved = true;
  await a.close();
  await gm.waitForTimeout(1700);
  assert.equal((await diagnostics(gm)).instances, 0);
  const reconnected = await login("Yurez The Next");
  assert.deepEqual(
    await reconnected.evaluate(() => yurots.protocol.position),
    originalA,
  );
  result.safeReconnect = true;
  assert.deepEqual(errors, []);
  result.ok = true;
  result.errors = errors;
  await writeFile(new URL("state.json", out), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await reconnected.click("#logout");
  await gm.click("#logout");
} catch (e) {
  console.error(e);
  result.failure = e.stack;
  for (const p of pages)
    if (!p.isClosed())
      console.error(await p.evaluate(() => render_game_to_text()));
  await writeFile(new URL("state.json", out), JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
