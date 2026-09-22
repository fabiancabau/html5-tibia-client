import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { loginPacket, readLogin } from "../yurots/bytes.mjs";
import { frame, Framer } from "../gateway/framing.mjs";
const out = new URL("../artifacts/advanced/", import.meta.url);
await mkdir(out, { recursive: true });
// Regression for the old recv-once implementation: deliberately fragment the handshake.
await new Promise((resolve, reject) => {
  const socket = net.createConnection({ host: "127.0.0.1", port: 7171 });
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error("Fragmented login timed out"));
  }, 10000);
  const parser = new Framer((bytes) => {
    try {
      assert(readLogin(bytes).characters.length > 0);
      clearTimeout(timer);
      socket.destroy();
      resolve();
    } catch (e) {
      reject(e);
    }
  });
  socket.on("data", (b) => parser.push(b));
  socket.on("error", reject);
  socket.on("connect", async () => {
    const bytes = frame(Buffer.from(loginPacket(111111, "tibia")));
    for (const b of bytes) {
      socket.write(Buffer.from([b]));
      await new Promise((r) => setTimeout(r, 4));
    }
  });
});
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1280, height: 1050 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
async function say(text) {
  await page.fill("#chat-input", text);
  await page.locator("#chat-form button").click();
}
async function state() {
  return JSON.parse(await page.evaluate(() => render_game_to_text()));
}
async function login(name, password = "tibia") {
  await page.fill("#account", "111111");
  await page.fill("#password", password);
  await page.click("#login");
  if (password !== "tibia") return;
  await page
    .getByRole("button", { name: `${name} · YurOTS`, exact: true })
    .click();
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "playing",
  );
  await page.waitForTimeout(300);
}
try {
  await page.goto(process.env.CLIENT_URL || "http://127.0.0.1:8080");
  await page.waitForFunction(() => yurots.assets.loaded);
  await login("Yurez", "wrong-password");
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("valid account"),
  );
  await login("Yurez");
  await page.locator('[aria-label="Backpack"]').dblclick();
  await page.waitForFunction(() => yurots.protocol.containers.size > 0);
  const item = await page.evaluate(() => {
    const item = yurots.protocol.inventory.get(6),
      container = [...yurots.protocol.containers.keys()][0];
    yurots.moveItem(
      { position: { x: 65535, y: 6, z: 0 }, item, stack: 0 },
      { x: 65535, y: 64 + container, z: 0 },
    );
    return { id: item.id, count: item.count, container };
  });
  await page.waitForFunction(() => !yurots.protocol.inventory.has(6));
  await page.evaluate(({ id, container }) => {
    const c = yurots.protocol.containers.get(container),
      index = c.items.findIndex((x) => x.id === id);
    yurots.moveItem(
      {
        position: { x: 65535, y: 64 + container, z: index },
        item: c.items[index],
        stack: index,
      },
      { x: 65535, y: 6, z: 0 },
    );
  }, item);
  await page.waitForFunction(
    (id) => yurots.protocol.inventory.get(6)?.id === id,
    item.id,
  );
  const mana = (await state()).player.mana;
  await say("exura");
  await page.waitForFunction((mana) => yurots.protocol.stats.mana < mana, mana);
  await page.click("#channels");
  await page.locator("#dialog").waitFor({ state: "visible" });
  const channelCount = await page.locator("#dialog-body button").count();
  assert(channelCount > 0);
  await page.locator("#dialog-body button").first().click();
  await page.waitForFunction(
    () => document.querySelectorAll("#channel option").length > 3,
  );
  await page.screenshot({
    path: new URL("inventory-spell.png", out).pathname,
    fullPage: true,
  });
  await page.click("#logout");
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "login",
  );
  await login("GM Yurez");
  await say("/t");
  await page.waitForFunction(
    () =>
      yurots.protocol.position.x === 160 && yurots.protocol.position.y === 54,
  );
  const upper = await page.evaluate(
    () =>
      [...yurots.protocol.tiles.values()].find(
        (t) =>
          t.position.z === 6 &&
          t.things.some(
            (x) =>
              x.kind === "item" && yurots.assets.flag(x.id, "DatFlagGround"),
          ),
      )?.position,
  );
  assert(upper, "Expected an upper floor in the temple viewport");
  await say(`/send GM Yurez,${upper.x} ${upper.y} ${upper.z}`);
  await page.waitForFunction(() => yurots.protocol.position.z === 6);
  await page.screenshot({
    path: new URL("floor6.png", out).pathname,
    fullPage: true,
  });
  await say("/t");
  await page.waitForFunction(() => yurots.protocol.position.z === 7);
  await say("/m Rat");
  await page.waitForFunction(() =>
    JSON.parse(render_game_to_text()).creatures.some(
      (c) => c.name.toLowerCase() === "rat",
    ),
  );
  const rat = (await state()).creatures.find(
    (c) => c.name.toLowerCase() === "rat",
  );
  await page.getByRole("button", { name: new RegExp("^Rat ·") }).click();
  await page.waitForFunction(
    (id) => {
      const s = JSON.parse(render_game_to_text()),
        c = s.creatures.find((c) => c.id === id);
      return !c || c.health < 100;
    },
    rat.id,
    { timeout: 15000 },
  );
  await page.screenshot({
    path: new URL("combat.png", out).pathname,
    fullPage: true,
  });
  const final = await state();
  assert.deepEqual(final.errors, []);
  assert.deepEqual(errors, []);
  await writeFile(new URL("state.json", out), JSON.stringify(final, null, 2));
  await page.click("#stop-attack");
  await page.click("#logout");
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "login",
  );
  console.log(
    JSON.stringify({
      ok: true,
      fragmentedTcpLogin: true,
      badPassword: true,
      moveItemRoundtrip: true,
      spell: true,
      channels: channelCount,
      floorChange: upper,
      combat: true,
      errors,
    }),
  );
} catch (error) {
  console.error(error);
  console.error(await state());
  await page.screenshot({
    path: new URL("failure.png", out).pathname,
    fullPage: true,
  });
  process.exitCode = 1;
} finally {
  await browser.close();
}
