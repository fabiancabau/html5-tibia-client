import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.CLIENT_URL || "http://127.0.0.1:8084",
  out = new URL("../artifacts/hunts/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(url);
  await page.waitForFunction(() => yurots.assets.loaded);
  await page.fill("#account", process.env.TEST_ACCOUNT || "111111");
  await page.fill("#password", process.env.TEST_PASSWORD || "tibia");
  await page.click("#login");
  await page
    .getByRole("button", {
      name: `${process.env.TEST_CHARACTER || "Yurez The Next"} · YurOTS`,
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "playing",
  );
  const before = await page.evaluate(() =>
    structuredClone(yurots.protocol.position),
  );
  await page.click("#hunts");
  await page.waitForFunction(
    () => yurots.huntUI.catalog.length === 247,
    {},
    { timeout: 20000 },
  );
  assert.equal(await page.locator(".hunt-card").count(), 247);
  await page.screenshot({
    path: new URL("catalog.png", out).pathname,
    fullPage: true,
  });
  await page.fill("#hunt-search", "Rat");
  const selected = await page.evaluate(() =>
    yurots.huntUI.catalog.find(
      (h) => h.monsters.every((m) => m.name === "Rat") && h.spawns >= 3,
    ),
  );
  assert(selected);
  await page.locator(`[data-hunt-id="${selected.id}"] .hunt-card-main`).click();
  await page.locator("#hunt-start").waitFor({ state: "visible" });
  await page.screenshot({
    path: new URL("detail.png", out).pathname,
    fullPage: true,
  });
  await page.click("#hunt-start");
  await page.waitForFunction(
    () => yurots.protocol.huntState?.active,
    {},
    { timeout: 20000 },
  );
  const started = await page.evaluate(() => ({
    position: yurots.protocol.position,
    hunt: yurots.protocol.huntState,
  }));
  assert(started.position.x >= 4096);
  assert(started.hunt.automatic);
  await page.waitForFunction(
    () => yurots.protocol.huntState.kills >= 2,
    {},
    { timeout: 60000 },
  );
  await page.waitForFunction(() => yurots.protocol.huntState.experience > 0);
  await page.screenshot({
    path: new URL("auto-hunt.png", out).pathname,
    fullPage: true,
  });
  let hunting = await page.evaluate(() => JSON.parse(render_game_to_text()));
  if (process.env.TEST_RESPAWN === "1") {
    console.log(
      "Initial kills verified; waiting for the original respawn timer.",
    );
    await page.waitForFunction(
      (total) => yurots.protocol.huntState.kills > total,
      selected.spawns,
      { timeout: 80000 },
    );
    hunting = await page.evaluate(() => JSON.parse(render_game_to_text()));
    await page.screenshot({
      path: new URL("respawn-cycle.png", out).pathname,
      fullPage: true,
    });
  }

  await page.click("#hunt-pause");
  await page.waitForFunction(
    () => yurots.protocol.huntState.automatic === false,
  );
  await page.waitForTimeout(400);
  await page.click("#hunt-pause");
  await page.waitForFunction(
    () => yurots.protocol.huntState.automatic === true,
  );
  await page.waitForTimeout(400);
  await page.click("#hunt-leave");
  await page.waitForFunction(() => !yurots.protocol.huntState.active);
  assert.deepEqual(await page.evaluate(() => yurots.protocol.position), before);
  await page.screenshot({
    path: new URL("returned.png", out).pathname,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("state.json", out),
    JSON.stringify({ before, selected, started, hunting, errors }, null, 2),
  );
  await page.click("#logout");
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "login",
  );
  console.log(
    JSON.stringify({
      ok: true,
      catalog: 247,
      huntId: selected.id,
      instance: started.hunt.instance,
      kills: hunting.hunt.kills,
      experience: hunting.hunt.experience,
      loot: hunting.hunt.items,
      pauseResume: true,
      respawnVerified: process.env.TEST_RESPAWN === "1",
      returnPosition: before,
      errors,
    }),
  );
} catch (error) {
  console.error(error);
  console.error(
    await page.evaluate(() => ({
      status: document.getElementById("status")?.textContent,
      alert: document.getElementById("hunt-alert")?.textContent,
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
