import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

// Run in an isolated copy of the supplied world, with a normal player at the
// temple (160,54,7). Raw packets deliberately bypass client wall checks so the
// server cooldown regression cannot be hidden by a successful browser fix.
const base = process.env.CLIENT_URL || "http://127.0.0.1:8082";
const baseline = process.env.MOVEMENT_BASELINE === "1";
const out = new URL(`../artifacts/movement/${baseline ? "before" : "after"}/`, import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], checks = {};
let holdReplies = false, forwardReply;
const replies = [];
await page.routeWebSocket("**/game", (ws) => {
  const server = ws.connectToServer();
  forwardReply = (message) => ws.send(message);
  server.onMessage((message) => {
    if (holdReplies) replies.push(message);
    else ws.send(message);
  });
});
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const pos = () => page.evaluate(() => ({ ...yurots.protocol.position }));
const settle = () => page.waitForTimeout(1150);
const waitAt = (p) => page.waitForFunction((p) =>
  ["x", "y", "z"].every((axis) => yurots.protocol.position[axis] === p[axis]), p);

async function rawStep(direction) {
  return page.evaluate(async (direction) => {
    const opcodes = { north: 0x65, east: 0x66, south: 0x67, west: 0x68, northeast: 0x6a, southeast: 0x6b, southwest: 0x6c, northwest: 0x6d };
    return new Promise((resolve, reject) => {
      const p = yurots.protocol, emit = p.emit, start = performance.now();
      const timer = setTimeout(() => { p.emit = emit; reject(new Error("Movement reply timed out")); }, 4000);
      p.emit = (type, data) => {
        emit(type, data);
        if (type !== "move" && type !== "cancelWalk") return;
        p.emit = emit;
        clearTimeout(timer);
        resolve({ type, elapsed: performance.now() - start, position: { ...p.position } });
      };
      yurots.send(new Uint8Array([opcodes[direction]]));
    });
  }, direction);
}

async function stage(target) {
  const route = await page.evaluate((p) => yurots.findPath(p), target);
  for (const direction of route) {
    const result = await rawStep(direction);
    assert.equal(result.type, "move", `Fixture route blocked: ${direction}`);
  }
  assert.deepEqual(await pos(), target);
  await settle();
  await page.locator("#screen").focus();
}

try {
  await page.goto(base);
  await page.waitForFunction(() => window.yurots?.assets.loaded);
  await page.fill("#account", process.env.TEST_ACCOUNT || "111111");
  await page.fill("#password", process.env.TEST_PASSWORD || "tibia");
  await page.click("#login");
  await page.getByRole("button", { name: `${process.env.TEST_CHARACTER || "Yurez The Next"} · YurOTS`, exact: true }).click();
  await page.waitForFunction(() => JSON.parse(render_game_to_text()).mode === "playing");
  await page.evaluate(() => {
    window.moveTrace = [];
    const original = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
      const opcode = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength)[0];
      if ([0x65, 0x66, 0x67, 0x68, 0x6a, 0x6b, 0x6c, 0x6d].includes(opcode))
        moveTrace.push({ type: "send", opcode, at: performance.now() });
      return original.call(this, data);
    };
    const emit = yurots.protocol.emit;
    yurots.protocol.emit = (type, data) => {
      if (["move", "cancelWalk"].includes(type)) moveTrace.push({ type, at: performance.now(), position: { ...yurots.protocol.position } });
      emit(type, data);
    };
  });

  await stage({ x: 160, y: 55, z: 7 });
  const expectedStep = await page.evaluate(() => Math.floor(100000 / yurots.protocol.player.speed));
  assert.equal((await rawStep("south")).type, "cancelWalk");
  checks.serverWallRecovery = await rawStep("east");
  assert.deepEqual(checks.serverWallRecovery.position, { x: 161, y: 55, z: 7 });
  if (!baseline) assert(checks.serverWallRecovery.elapsed < expectedStep * 0.55,
    `Wall added a movement penalty: ${checks.serverWallRecovery.elapsed}ms`);

  if (!baseline) {
    checks.cardinalCooldown = await rawStep("west");
    assert(checks.cardinalCooldown.elapsed >= expectedStep * 0.7, "Successful steps must remain rate-limited");
    await settle();
    checks.firstDiagonal = await rawStep("northeast");
    assert(checks.firstDiagonal.elapsed < expectedStep * 0.55, "An idle diagonal should start immediately");
    checks.diagonalCooldown = await rawStep("west");
    assert(checks.diagonalCooldown.elapsed >= expectedStep * 1.6, "Diagonal steps must retain their full cost");

    await stage({ x: 160, y: 55, z: 7 });
    await page.evaluate(() => yurots.send(new Uint8Array([0x64, 2, 7, 1])));
    await settle();
    assert.deepEqual(await pos(), { x: 160, y: 55, z: 7 }, "A blocked native auto-walk must discard its remaining route");
    await page.evaluate(() => yurots.send(new Uint8Array([0x64, 0])));
    await page.waitForTimeout(100);
    assert.equal((await rawStep("east")).type, "move", "An empty native path must leave the session usable");
    checks.nativePathCancellation = true;

    await stage({ x: 160, y: 55, z: 7 });
    await page.evaluate(() => { moveTrace.length = 0; });
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(650);
    assert.equal(await page.evaluate(() => moveTrace.filter(e => e.type === "send").length), 0, "Visible walls must not generate walk packets");
    const turnStart = await page.evaluate(() => performance.now());
    await page.keyboard.down("ArrowRight");
    await waitAt({ x: 161, y: 55, z: 7 });
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowDown");
    checks.keyboardWallRecovery = await page.evaluate((start) => moveTrace.find(e => e.type === "move").at - start, turnStart);
    assert(checks.keyboardWallRecovery < expectedStep * 0.55);
    await settle();
    assert.deepEqual(await pos(), { x: 161, y: 55, z: 7 }, "Released keys must not leave extra steps");

    await stage({ x: 160, y: 54, z: 7 });
    await page.keyboard.press("ArrowRight");
    await waitAt({ x: 161, y: 54, z: 7 });
    await page.keyboard.press("ArrowDown");
    await waitAt({ x: 161, y: 55, z: 7 });
    await settle();
    assert.deepEqual(await pos(), { x: 161, y: 55, z: 7 });
    checks.quickTapDuringCooldown = true;

    await stage({ x: 160, y: 54, z: 7 });
    await page.keyboard.down("ArrowRight");
    await waitAt({ x: 161, y: 54, z: 7 });
    await page.keyboard.down("ArrowUp");
    await waitAt({ x: 161, y: 53, z: 7 });
    await page.keyboard.up("ArrowUp");
    await waitAt({ x: 162, y: 53, z: 7 });
    await page.keyboard.up("ArrowRight");
    await settle();
    assert.deepEqual(await pos(), { x: 162, y: 53, z: 7 });
    checks.overlappingKeys = true;

    await stage({ x: 160, y: 54, z: 7 });
    await page.keyboard.press("ArrowRight");
    await waitAt({ x: 161, y: 54, z: 7 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await settle();
    assert.deepEqual(await pos(), { x: 161, y: 54, z: 7 });
    await page.keyboard.press("ArrowLeft");
    await waitAt({ x: 160, y: 54, z: 7 });
    checks.escapeClearsBufferedTurn = true;

    await stage({ x: 160, y: 54, z: 7 });
    const target = { x: 164, y: 54, z: 7 };
    const point = await page.evaluate((target) => {
      const r = yurots.renderer, at = r.screen(target, r.camera(yurots.protocol));
      const box = r.canvas.getBoundingClientRect();
      return { x: box.left + (at.x + 16) * box.width / r.canvas.width,
        y: box.top + (at.y + 16) * box.height / r.canvas.height };
    }, target);
    await page.mouse.click(point.x, point.y);
    await waitAt({ x: 161, y: 54, z: 7 });
    await page.keyboard.press("ArrowUp");
    await waitAt({ x: 161, y: 53, z: 7 });
    await settle();
    assert.deepEqual(await pos(), { x: 161, y: 53, z: 7 });
    checks.keyboardInterruptsClickPath = true;

    await stage({ x: 160, y: 54, z: 7 });
    await page.keyboard.press("Numpad9");
    await waitAt({ x: 161, y: 53, z: 7 });
    await page.waitForTimeout(180);
    await page.screenshot({ path: new URL("diagonal.png", out).pathname });
    await settle();
    checks.numpadDiagonal = true;

    await stage({ x: 160, y: 54, z: 7 });
    await page.evaluate(() => { moveTrace.length = 0; });
    holdReplies = true;
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(1250);
    assert.equal(await page.evaluate(() => moveTrace.filter(e => e.type === "send").length), 1,
      "A delayed server must never accumulate movement packets");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.up("ArrowRight");
    holdReplies = false;
    for (const reply of replies.splice(0)) forwardReply(reply);
    await waitAt({ x: 161, y: 55, z: 7 });
    await settle();
    assert.deepEqual(await pos(), { x: 161, y: 55, z: 7 });
    assert.equal(await page.evaluate(() => moveTrace.filter(e => e.type === "send").length), 2);
    checks.delayedReplyKeepsOnePendingStep = true;
  }
  const state = await page.evaluate(() => JSON.parse(render_game_to_text()));
  const trace = await page.evaluate(() => moveTrace);
  assert.deepEqual(errors, []);
  assert.deepEqual(state.errors, []);
  await page.screenshot({ path: new URL("world.png", out).pathname });
  await writeFile(new URL("results.json", out), JSON.stringify({ checks, state, trace, errors }, null, 2));
  await page.click("#logout");
  await page.waitForFunction(() => JSON.parse(render_game_to_text()).mode === "login");
  console.log(JSON.stringify({ baseline, checks, errors }, null, 2));
} catch (error) {
  console.error(error);
  console.error(await page.evaluate(() => window.render_game_to_text?.()));
  await page.screenshot({ path: new URL("failure.png", out).pathname });
  process.exitCode = 1;
} finally { await browser.close(); }
