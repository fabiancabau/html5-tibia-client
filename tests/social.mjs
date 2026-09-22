import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ headless: true }),
  gm = await browser.newPage({ viewport: { width: 1280, height: 1050 } }),
  player = await browser.newPage({ viewport: { width: 1280, height: 1050 } }),
  errors = [];
for (const p of [gm, player]) p.on("pageerror", (e) => errors.push(e.message));
async function login(page, name) {
  await page.goto("http://127.0.0.1:8080");
  await page.waitForFunction(() => yurots.assets.loaded);
  await page.fill("#account", "111111");
  await page.fill("#password", "tibia");
  await page.click("#login");
  await page
    .getByRole("button", { name: `${name} · YurOTS`, exact: true })
    .click();
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "playing",
  );
}
async function say(page, text) {
  await page.fill("#chat-input", text);
  await page.locator("#chat-form button").click();
}
async function action(page, op, id) {
  await page.evaluate(
    async ({ op, id }) => {
      const { Writer } = await import("/yurots/bytes.mjs");
      yurots.send(new Writer(op).u32(id));
    },
    { op, id },
  );
}
try {
  await login(gm, "GM Yurez");
  await login(player, "Yurez");
  await say(gm, "/t");
  await say(gm, "/send Yurez,159 54 7");
  await player.waitForFunction(
    () =>
      yurots.protocol.position.x === 159 && yurots.protocol.position.y === 54,
  );
  const gid = await gm.evaluate(() => yurots.protocol.playerId),
    pid = await player.evaluate(() => yurots.protocol.playerId);
  await action(gm, 0xa3, pid);
  await player.waitForFunction(() =>
    JSON.parse(render_game_to_text()).messages.some((s) =>
      s.includes("invites you"),
    ),
  );
  await action(player, 0xa4, gid);
  await player.waitForFunction(() =>
    JSON.parse(render_game_to_text()).messages.some((s) =>
      s.includes("joined"),
    ),
  );
  await player.click("#add-vip");
  await player.locator("#dialog-body input").fill("GM Yurez");
  await player.click("#dialog-accept");
  await player.waitForFunction(() =>
    [...yurots.protocol.vip.values()].some(
      (f) => f.name === "GM Yurez" && f.online,
    ),
  );
  await say(player, "@GM Yurez@Private browser check");
  await gm.waitForFunction(() =>
    JSON.parse(render_game_to_text()).messages.some((s) =>
      s.includes("Private browser check"),
    ),
  );
  for (const [page, partner, slot] of [
    [gm, pid, 5],
    [player, gid, 2],
  ])
    await page.evaluate(
      async ({ partner, slot }) => {
        const { Writer } = await import("/yurots/bytes.mjs");
        const item = yurots.protocol.inventory.get(slot);
        yurots.send(
          new Writer(0x7d)
            .pos({ x: 65535, y: slot, z: 0 })
            .u16(item.id)
            .u8(0)
            .u32(partner),
        );
      },
      { partner, slot },
    );
  await gm.waitForFunction(
    () =>
      document.getElementById("dialog").open &&
      !document.getElementById("dialog-accept").disabled,
  );
  await player.waitForFunction(
    () =>
      document.getElementById("dialog").open &&
      !document.getElementById("dialog-accept").disabled,
  );
  await mkdir(new URL("../artifacts/social/", import.meta.url), {
    recursive: true,
  });
  await gm.screenshot({
    path: new URL("../artifacts/social/trade.png", import.meta.url).pathname,
    fullPage: true,
  });
  // Cancel rather than exchanging the sample characters' equipment.
  await gm.locator('#dialog button[value="cancel"]').click();
  await player.waitForFunction(() => !document.getElementById("dialog").open);
  await action(player, 0xa7, 0);
  await player.click("#logout");
  await gm.click("#logout");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      partyJoin: true,
      vip: true,
      privateMessage: true,
      twoSidedTradeOffers: true,
      tradeCancellation: true,
      errors,
    }),
  );
} catch (error) {
  console.error(error);
  console.error(await gm.evaluate(() => render_game_to_text()));
  console.error(await player.evaluate(() => render_game_to_text()));
  process.exitCode = 1;
} finally {
  await browser.close();
}
