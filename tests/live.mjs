import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.CLIENT_URL || "http://127.0.0.1:8080",
  out = new URL("../artifacts/live/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1280, height: 1050 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(base);
  await page.waitForFunction(() => window.yurots?.assets.loaded);
  await page.screenshot({
    path: new URL("login.png", out).pathname,
    fullPage: true,
  });
  await page.fill("#account", process.env.TEST_ACCOUNT || "111111");
  await page.fill("#password", process.env.TEST_PASSWORD || "tibia");
  await page.click("#login");
  await page
    .getByRole("button", {
      name: `${process.env.TEST_CHARACTER || "Yurez"} · YurOTS`,
      exact: true,
    })
    .click({ timeout: 15000 });
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "playing",
    {},
    { timeout: 20000 },
  );
  await page.waitForTimeout(600);
  const initial = JSON.parse(await page.evaluate(() => render_game_to_text()));
  assert(initial.tiles > 100);
  assert(initial.player.health > 0);
  await page.screenshot({
    path: new URL("world.png", out).pathname,
    fullPage: true,
  });
  const route = await page.evaluate(() => {
    const p = yurots.protocol.position;
    for (const [dx, dy, key] of [
      [0, 1, "ArrowDown"],
      [1, 0, "ArrowRight"],
      [0, -1, "ArrowUp"],
      [-1, 0, "ArrowLeft"],
    ]) {
      const target = { x: p.x + dx, y: p.y + dy, z: p.z };
      if (yurots.findPath(target).length === 1) return { key, target };
    }
    return null;
  });
  assert(route, "No walkable neighbor in test spawn");
  await page.locator("#screen").focus();
  await page.keyboard.press(route.key);
  await page.waitForFunction((expected) => {
    const p = yurots.protocol.position;
    return p.x === expected.x && p.y === expected.y;
  }, route.target);
  await page.waitForTimeout(550);
  await page.locator('[aria-label="Backpack"]').dblclick();
  await page.waitForFunction(() => yurots.protocol.containers.size > 0);
  const opened = JSON.parse(await page.evaluate(() => render_game_to_text()));
  assert(opened.containers[0].items.length > 0);
  await page.fill("#chat-input", "Browser integration check");
  await page.locator("#chat-form button").click();
  await page.waitForFunction(() =>
    JSON.parse(render_game_to_text()).messages.some((m) =>
      m.includes("Browser integration check"),
    ),
  );
  await page.click("#outfit");
  await page.locator("#dialog").waitFor({ state: "visible" });
  await page.locator('#dialog button[value="cancel"]').click();
  await page.screenshot({
    path: new URL("playing.png", out).pathname,
    fullPage: true,
  });
  const state = JSON.parse(await page.evaluate(() => render_game_to_text()));
  assert.equal(state.errors.length, 0);
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("state.json", out),
    JSON.stringify({ initial, state }, null, 2),
  );
  await page.click("#logout");
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "login",
  );
  console.log(
    JSON.stringify({
      ok: true,
      login: true,
      mapTiles: initial.tiles,
      positionBefore: initial.player.position,
      positionAfter: state.player.position,
      containerItems: opened.containers[0].items.length,
      chat: true,
      outfit: true,
      logout: true,
      errors,
    }),
  );
} catch (e) {
  console.error(e);
  console.error(
    await page.evaluate(() => ({
      status: document.getElementById("status").textContent,
      state: window.render_game_to_text?.(),
    })),
  );
  await page.screenshot({
    path: new URL("failure.png", out).pathname,
    fullPage: true,
  });
  process.exitCode = 1;
} finally {
  await browser.close();
}
