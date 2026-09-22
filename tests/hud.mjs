import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

// Live regression: this deliberately uses real YurOTS login and game packets.
// Run one browser suite at a time so the same character is not already online.
const base = process.env.CLIENT_URL || "http://127.0.0.1:8081",
  account = process.env.TEST_ACCOUNT || "111111",
  password = process.env.TEST_PASSWORD || "tibia",
  character = process.env.TEST_CHARACTER || "Yurez The Next",
  out = new URL("../artifacts/hud/", import.meta.url),
  errors = [],
  sent = [],
  sockets = [],
  checks = {};
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("websocket", (socket) => {
  if (!new URL(socket.url()).pathname.endsWith("/game")) return;
  const observed = { open: true, receivedFrames: 0 };
  sockets.push(observed);
  socket.on("close", () => {
    observed.open = false;
  });
  socket.on("framereceived", () => {
    observed.receivedFrames++;
  });
  socket.on("framesent", ({ payload }) => {
    const bytes = Buffer.from(payload);
    // Record gameplay only; never retain the game-login packet or credentials.
    if (bytes[0] !== 0x0a)
      sent.push({
        opcode: bytes[0],
        speech: bytes[0] === 0x96 ? bytes.subarray(4).toString("latin1") : null,
      });
  });
});

const state = () => page.evaluate(() => JSON.parse(render_game_to_text()));
const screenshot = (name) =>
  page.screenshot({
    path: new URL(`${name}.png`, out).pathname,
    fullPage: true,
  });
const speechSince = (index) =>
  sent.slice(index).filter((packet) => packet.opcode === 0x96);
async function login() {
  await page.waitForFunction(() => window.yurots?.assets.loaded);
  await page.fill("#account", account);
  await page.fill("#password", password);
  await page.click("#login");
  await page
    .getByRole("button", { name: `${character} · YurOTS`, exact: true })
    .click();
  await page.waitForFunction(
    () => JSON.parse(render_game_to_text()).mode === "playing",
  );
  await page.waitForFunction(
    () => yurots.protocol.stats.health > 0 && yurots.protocol.tiles.size > 100,
  );
  await page.waitForTimeout(250);
}
async function logout() {
  const mark = sent.length;
  await page.click("#logout");
  try {
    await page.waitForFunction(
      () => JSON.parse(render_game_to_text()).mode === "login",
      null,
      { timeout: 12000 },
    );
  } catch (error) {
    checks.logoutFailure = await page.evaluate(() => ({
      status: document.getElementById("status").textContent,
      notice: document.getElementById("notice").textContent,
      messages: document.getElementById("messages").innerText,
      state: JSON.parse(render_game_to_text()),
    }));
    checks.logoutFailure.sentOpcodes = sent
      .slice(mark)
      .map((packet) => packet.opcode);
    checks.logoutFailure.gameSockets = sockets.map((socket) => ({ ...socket }));
    await screenshot("logout-failure");
    throw new Error(
      `Logout did not complete: ${JSON.stringify(checks.logoutFailure)}`,
      { cause: error },
    );
  }
}
async function panel(id, visible) {
  if ((await page.locator(`#${id}`).isVisible()) !== visible)
    await page.locator(`[data-panel-toggle="${id}"]`).click();
  await page
    .locator(`#${id}`)
    .waitFor({ state: visible ? "visible" : "hidden" });
}
async function layout(name, viewport) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(250);
  const result = await page.evaluate(() => {
    const screen = document.getElementById("screen"),
      rect = screen.getBoundingClientRect(),
      frame = screen.closest(".world-frame").getBoundingClientRect(),
      game = document.getElementById("game").getBoundingClientRect();
    return {
      screen: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      frame: {
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
      },
      game: { x: game.x, y: game.y, width: game.width, height: game.height },
      logical: { width: screen.width, height: screen.height },
      innerWidth,
      innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      health: document.getElementById("health").textContent,
      mana: document.getElementById("mana").textContent,
      player: document.getElementById("top-player-name").textContent,
      xp: document.getElementById("xp-label").textContent,
      xpWidth: parseFloat(document.getElementById("xp-fill").style.width),
      stats: yurots.protocol.stats,
      offscreenControls: [
        ...document.querySelectorAll("button, input, select"),
      ].flatMap((control) => {
        const box = control.getBoundingClientRect();
        if (
          !box.width ||
          !box.height ||
          (box.left >= 0 &&
            box.top >= 0 &&
            box.right <= innerWidth + 1 &&
            box.bottom <= innerHeight + 1)
        )
          return [];
        return [
          {
            label:
              control.id ||
              control.getAttribute("aria-label") ||
              control.textContent.trim(),
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          },
        ];
      }),
    };
  });
  checks.lastLayout = { name, ...result };
  assert(
    result.scrollWidth <= viewport.width + 1,
    `${name}: horizontal overflow`,
  );
  for (const axis of ["x", "y", "width", "height"])
    assert(
      Math.abs(result.screen[axis] - result.frame[axis]) <= 2,
      `${name}: canvas does not fill world frame (${axis})`,
    );
  assert(
    result.screen.width >= viewport.width - 2,
    `${name}: game world should span the viewport`,
  );
  assert(
    result.screen.height >= result.game.height - 2,
    `${name}: game world should fill game area`,
  );
  assert(
    result.logical.width <= 17 * 32 && result.logical.height <= 13 * 32,
    `${name}: viewport exceeds server map coverage`,
  );
  assert(
    Math.abs(
      result.logical.width / result.logical.height -
        result.screen.width / result.screen.height,
    ) < 0.03,
    `${name}: stretched map aspect ratio`,
  );
  assert.equal(result.player.toLowerCase(), character.toLowerCase());
  assert.equal(
    result.health.replace(/\s/g, ""),
    `${result.stats.health}/${result.stats.maxHealth}`,
  );
  assert.equal(
    result.mana.replace(/\s/g, ""),
    `${result.stats.mana}/${result.stats.maxMana}`,
  );
  assert(
    Number.isFinite(result.xpWidth) &&
      result.xpWidth >= 0 &&
      result.xpWidth <= 100,
  );
  assert(result.xp.length > 0);
  await screenshot(name);
  return result;
}
async function walk(click = false) {
  // Pick a reachable tile using the real server map; do not alter game state.
  const route = await page.evaluate((click) => {
    const p = yurots.protocol.position,
      canvas = document.getElementById("screen"),
      rect = canvas.getBoundingClientRect(),
      renderer = yurots.renderer;
    for (const [dx, dy, key] of [
      [0, 1, "ArrowDown"],
      [1, 0, "ArrowRight"],
      [0, -1, "ArrowUp"],
      [-1, 0, "ArrowLeft"],
    ]) {
      const target = { x: p.x + dx, y: p.y + dy, z: p.z };
      const tile = yurots.protocol.tiles.get(
        `${target.x},${target.y},${target.z}`,
      );
      if (
        !tile?.things.some(
          (thing) =>
            thing.kind === "item" &&
            yurots.assets.flag(thing.id, "DatFlagGround"),
        ) ||
        tile.things.some(
          (thing) =>
            thing.kind === "creature" ||
            yurots.assets.flag(thing.id, "DatFlagNotWalkable"),
        )
      )
        continue;
      if (yurots.findPath(target).length !== 1) continue;
      if (!click) return { key, target };
      const at = renderer.screen(target, renderer.camera(yurots.protocol)),
        x = rect.left + ((at.x + 16) / canvas.width) * rect.width,
        y = rect.top + ((at.y + 16) / canvas.height) * rect.height;
      if (document.elementFromPoint(x, y) === canvas)
        return { key, target, x, y };
    }
    return null;
  }, click);
  assert(
    route,
    click
      ? "No unobstructed adjacent tile for pointer movement"
      : "No walkable adjacent tile",
  );
  if (click) await page.mouse.click(route.x, route.y);
  else {
    await page.locator("#screen").focus();
    await page.keyboard.press(route.key);
  }
  await page.waitForFunction((target) => {
    const p = yurots.protocol.position;
    return p.x === target.x && p.y === target.y && p.z === target.z;
  }, route.target);
  await page.waitForTimeout(550); // Let server-paced walking and camera interpolation settle.
  return route;
}

try {
  await page.goto(base);
  await login();
  checks.initial = await state();
  assert(checks.initial.connected && checks.initial.packets > 0);
  for (const id of [
    "panel-inventory",
    "panel-session",
    "panel-chat",
    "panel-battle",
    "panel-social",
  ])
    assert.equal(await page.locator(`#${id}.floating-panel`).count(), 1);
  for (let index = 1; index <= 8; index++)
    assert(
      (await page.locator("#hotbar").innerText()).includes(`F${index}`),
      `Missing hotkey F${index}`,
    );
  checks.layouts = {
    desktop: await layout("desktop-1440", { width: 1440, height: 900 }),
  };

  await panel("panel-chat", true);
  await page.locator('[data-panel-close="panel-chat"]').click();
  await page.locator("#screen").focus();
  await page.keyboard.press("Enter");
  await page.locator("#panel-chat").waitFor({ state: "visible" });
  assert(
    await page
      .locator("#chat-input")
      .evaluate((input) => input === document.activeElement),
    "Enter did not focus the reopened chat",
  );
  await panel("panel-social", true);
  await page.locator('[data-panel-toggle="panel-social"]').focus();
  await page.keyboard.press("Enter");
  await page.locator("#panel-social").waitFor({ state: "hidden" });
  await page.locator('[data-panel-toggle="panel-social"]').focus();
  await page.keyboard.press("Enter");
  await page.locator("#panel-social").waitFor({ state: "visible" });
  checks.enterFocus = { reopensChat: true, activatesToolbar: true };

  await panel("panel-inventory", true);
  await page.locator('[aria-label="Backpack"]').dblclick();
  await page.waitForFunction(() => yurots.protocol.containers.size > 0);
  assert((await state()).containers[0].items.length > 0);
  await screenshot("inventory-open");
  await page.locator('[data-panel-close="panel-inventory"]').click();
  await page.locator("#panel-inventory").waitFor({ state: "hidden" });
  await panel("panel-inventory", true);
  checks.panelToggle = true;

  await panel("panel-session", true);
  const previousTime = await page.locator("#session-time").innerText();
  await page.waitForFunction(
    (previous) =>
      document.getElementById("session-time").textContent !== previous,
    previousTime,
  );
  assert((await page.locator("#session-xp").innerText()).length > 0);
  const beforeDrag = await page.locator("#panel-session").boundingBox(),
    handle = await page
      .locator("#panel-session [data-panel-drag]")
      .boundingBox();
  await page.mouse.move(handle.x + 70, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 165, handle.y + handle.height / 2 + 45, {
    steps: 8,
  });
  await page.mouse.up();
  const afterDrag = await page.locator("#panel-session").boundingBox();
  assert(
    Math.abs(afterDrag.x - beforeDrag.x) > 30,
    "Hunt analyzer did not drag",
  );
  await page.locator('#hotbar [data-hotkey="4"]').click({ button: "right" });
  await page.locator("#hotkey-dialog").waitFor({ state: "visible" });
  const editorMark = sent.length;
  await page.keyboard.press("F1");
  await page.waitForTimeout(200);
  assert.deepEqual(
    speechSince(editorMark),
    [],
    "Hotkey sent a spell while its editor was open",
  );
  await page.locator("#hotkey-words").fill("exura");
  await page.locator('#hotkey-dialog button[type="submit"]').click();
  await logout();
  await page.reload();
  await login();
  const restored = await page.locator("#panel-session").boundingBox();
  assert(
    Math.abs(afterDrag.x - restored.x) <= 2 &&
      Math.abs(afterDrag.y - restored.y) <= 2,
    "Panel position was not restored after reload and login",
  );
  checks.dragPersistence = { before: beforeDrag, moved: afterDrag, restored };
  await page.locator('#hotbar [data-hotkey="4"]').click({ button: "right" });
  assert.equal(
    await page.locator("#hotkey-words").inputValue(),
    "exura",
    "Assigned hotkey did not persist after reload",
  );
  await page.locator("#hotkey-words").fill("");
  await page.locator('#hotkey-dialog button[type="submit"]').click();
  checks.hotkeyEditorPersistence = true;

  await panel("panel-chat", true);
  await page.fill("#chat-input", "Do not cast while typing");
  let mark = sent.length;
  await page.keyboard.press("F1");
  await page.waitForTimeout(250);
  assert.deepEqual(speechSince(mark), [], "Hotkey sent a spell while typing");
  assert.equal(
    await page.locator("#chat-input").inputValue(),
    "Do not cast while typing",
  );
  await page.fill("#chat-input", "");
  await page.click("#outfit");
  await page.locator("#dialog").waitFor({ state: "visible" });
  mark = sent.length;
  await page.keyboard.press("F1");
  await page.waitForTimeout(250);
  assert.deepEqual(
    speechSince(mark),
    [],
    "Hotkey sent a spell while a dialog was open",
  );
  await page.locator('#dialog button[value="cancel"]').click();
  const beforeSpell = await state();
  mark = sent.length;
  await page.locator("#screen").focus();
  await page.keyboard.press("F1");
  await page.waitForFunction(
    ({ mana, messages }) => {
      const current = JSON.parse(render_game_to_text());
      return (
        current.player.mana < mana ||
        JSON.stringify(current.messages) !== messages
      );
    },
    {
      mana: beforeSpell.player.mana,
      messages: JSON.stringify(beforeSpell.messages),
    },
  );
  assert(
    speechSince(mark).some((packet) => packet.speech === "exura"),
    "F1 did not send the configured healing spell",
  );
  checks.hotkeys = {
    spell: "exura",
    manaBefore: beforeSpell.player.mana,
    manaAfter: (await state()).player.mana,
    typingSuppressed: true,
    dialogSuppressed: true,
  };
  checks.keyboardWalk = await walk();
  checks.layouts.wide = await layout("wide-1920", {
    width: 1920,
    height: 1080,
  });
  checks.pointerWalkWide = await walk(true);
  checks.layouts.compact = await layout("compact-1000", {
    width: 1000,
    height: 760,
  });
  checks.pointerWalkCompact = await walk(true);
  const desktopPanels = await page
    .locator(".floating-panel")
    .evaluateAll((panels) =>
      Object.fromEntries(panels.map((panel) => [panel.id, !panel.hidden])),
    );
  checks.layouts.portrait = await layout("portrait-390", {
    width: 390,
    height: 844,
  });
  assert.equal(
    await page.locator(".floating-panel:visible").count(),
    0,
    "Portrait should initially leave the game world clear",
  );
  const toolbar = await page
    .locator(".game-nav button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.id || button.getAttribute("aria-label"),
          visible: rect.width > 0 && rect.height > 0,
          inBounds:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight,
          reachable: button.contains(
            document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            ),
          ),
        };
      }),
    );
  assert(toolbar.some((button) => button.label === "logout"));
  for (const button of toolbar)
    assert(
      button.visible && button.inBounds && button.reachable,
      `Portrait toolbar control is inaccessible: ${button.label}`,
    );
  await panel("panel-inventory", true);
  assert.equal(await page.locator(".floating-panel:visible").count(), 1);
  const inventoryBox = await page.locator("#panel-inventory").boundingBox(),
    dockBox = await page.locator("#combat-dock").boundingBox();
  assert(
    inventoryBox.x >= 0 &&
      inventoryBox.x + inventoryBox.width <= 390 &&
      inventoryBox.y >= 0 &&
      inventoryBox.y + inventoryBox.height <= dockBox.y,
    "Portrait inventory does not fit above the dock",
  );
  await screenshot("portrait-inventory");
  await panel("panel-chat", true);
  assert.equal(await page.locator(".floating-panel:visible").count(), 1);
  assert.equal(await page.locator("#panel-inventory").isVisible(), false);
  const chatBox = await page.locator("#panel-chat").boundingBox();
  assert(
    chatBox.x >= 0 &&
      chatBox.x + chatBox.width <= 390 &&
      chatBox.y + chatBox.height <= dockBox.y,
    "Portrait chat does not fit above the dock",
  );
  await screenshot("portrait-panel");
  checks.portraitPanels = {
    toolbar,
    inventoryBox,
    chatBox,
    dockBox,
    onePanelAtATime: true,
  };
  checks.layouts.restored = await layout("desktop-restored", {
    width: 1440,
    height: 900,
  });
  assert.deepEqual(
    await page
      .locator(".floating-panel")
      .evaluateAll((panels) =>
        Object.fromEntries(panels.map((panel) => [panel.id, !panel.hidden])),
      ),
    desktopPanels,
    "Desktop panel visibility was not restored after portrait mode",
  );
  checks.final = await state();
  assert.deepEqual(checks.final.errors, []);
  assert.deepEqual(errors, []);
  await logout();
  checks.ok = true;
  console.log(
    JSON.stringify({
      ok: true,
      login: true,
      viewportSizes: Object.keys(checks.layouts),
      dragPersistence: true,
      hotkeys: checks.hotkeys,
      keyboardAndPointerWalking: true,
      errors,
    }),
  );
} catch (error) {
  checks.failure = error.stack;
  checks.sentGameplay = sent;
  checks.gameSockets = sockets.map((socket) => ({ ...socket }));
  console.error(error);
  console.error("Sent gameplay packets:", JSON.stringify(sent));
  console.error(await state().catch(() => null));
  await screenshot("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL("state.json", out),
    JSON.stringify({ ...checks, errors }, null, 2),
  );
  await browser.close();
}
