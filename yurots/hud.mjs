import { Writer } from "./bytes.mjs";

const LAYOUT_KEY = "yurots.hud.layout.v1";
const HOTKEYS_KEY = "yurots.hud.hotkeys.v1";
const DEFAULT_HOTKEYS = ["exura", "utani hur", "utevo lux", "", "", "", "", ""];
const number = new Intl.NumberFormat("en-US");
const $ = (id) => document.getElementById(id);

function readSaved(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The HUD remains usable when browser storage is unavailable or full.
  }
}

function text(id, value) {
  const node = $(id);
  if (node && node.textContent !== String(value)) node.textContent = value;
}

function spellIcon(words) {
  if (words.startsWith("exura")) return 3152;
  if (words.startsWith("utani")) return 3079;
  if (words.startsWith("utevo")) return 2920;
  if (words.startsWith("exori")) return 3198;
  if (words.startsWith("adori")) return 3198;
  return 3147;
}

function duration(seconds) {
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

/** Floating game windows and shortcuts backed by the native 7.6 session. */
export class HunteraHUD {
  constructor({
    assets,
    send,
    notice = () => {},
    getProtocol,
    focusGame = () => {},
  }) {
    this.assets = assets;
    this.send = send;
    this.notice = notice;
    this.getProtocol = getProtocol;
    this.focusGame = focusGame;
    this.protocol = null;
    this.active = false;
    this.startedAt = null;
    this.startExperience = null;
    this.lastTick = -1;
    this.portraitSignature = "";
    this.iconsReady = false;
    this.drag = null;
    this.compact = false;
    this.desktopVisibility = null;
    this.panels = [...document.querySelectorAll(".floating-panel")];
    this.defaults = new Map(
      this.panels.map((panel) => [panel.id, !panel.hidden]),
    );
    this.layout = readSaved(LAYOUT_KEY, {});
    if (
      !this.layout ||
      Array.isArray(this.layout) ||
      typeof this.layout !== "object"
    )
      this.layout = {};
    const saved = readSaved(HOTKEYS_KEY, DEFAULT_HOTKEYS);
    this.hotkeys = DEFAULT_HOTKEYS.map((words, index) =>
      Array.isArray(saved) && typeof saved[index] === "string"
        ? saved[index].slice(0, 255)
        : words,
    );
    this.wirePanels();
    this.renderHotkeys();
    this.createHotkeyEditor();
    document.addEventListener("keydown", (event) => this.keydown(event));
    window.addEventListener("resize", () => this.clampPanels());
    $("reset-layout")?.addEventListener("click", () => this.resetLayout());
    this.updateSession();
  }

  wirePanels() {
    for (const panel of this.panels) {
      const saved = this.layout[panel.id];
      if (typeof saved?.visible === "boolean") panel.hidden = !saved.visible;
      const handle = panel.querySelector("[data-panel-drag]");
      if (!handle) continue;
      handle.style.touchAction = "none";
      handle.addEventListener("pointerdown", (event) => {
        if (
          event.button !== 0 ||
          event.target.closest(
            "button, input, select, textarea, a, [contenteditable]",
          )
        )
          return;
        event.preventDefault();
        const rect = panel.getBoundingClientRect();
        this.drag = {
          panel,
          handle,
          pointerId: event.pointerId,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        panel.classList.add("is-dragging");
        handle.setPointerCapture(event.pointerId);
        this.bringForward(panel);
      });
      handle.addEventListener("pointermove", (event) => {
        if (
          this.drag?.pointerId !== event.pointerId ||
          this.drag.panel !== panel
        )
          return;
        this.positionPanel(
          panel,
          event.clientX - this.drag.x,
          event.clientY - this.drag.y,
        );
      });
      const finish = (event) => {
        if (
          this.drag?.pointerId !== event.pointerId ||
          this.drag.panel !== panel
        )
          return;
        panel.classList.remove("is-dragging");
        this.drag = null;
        const rect = panel.getBoundingClientRect();
        if (!this.compact) {
          this.layout[panel.id] = {
            visible: !panel.hidden,
            left: rect.left,
            top: rect.top,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          };
          save(LAYOUT_KEY, this.layout);
        }
        if (handle.hasPointerCapture(event.pointerId))
          handle.releasePointerCapture(event.pointerId);
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
      handle.addEventListener("lostpointercapture", finish);
      panel.addEventListener("pointerdown", () => this.bringForward(panel));
    }
    for (const button of document.querySelectorAll("[data-panel-toggle]")) {
      button.addEventListener("click", () => {
        const panel = $(button.dataset.panelToggle);
        if (!panel) return;
        this.setPanelVisible(panel, panel.hidden);
        this.focusGame();
      });
    }
    for (const button of document.querySelectorAll("[data-panel-close]")) {
      button.addEventListener("click", () => {
        const panel =
          $(button.dataset.panelClose) || button.closest(".floating-panel");
        if (panel) this.setPanelVisible(panel, false);
        this.focusGame();
      });
    }
    this.updateToggles();
  }

  bringForward(panel) {
    this.panels = this.panels.filter((item) => item !== panel).concat(panel);
    this.panels.forEach((item, index) => (item.style.zIndex = 20 + index));
  }

  setPanelVisible(panel, visible) {
    if (this.compact && visible) {
      for (const other of this.panels) other.hidden = other !== panel;
    } else panel.hidden = !visible;
    if (!this.compact) {
      this.layout[panel.id] = { ...this.layout[panel.id], visible };
      save(LAYOUT_KEY, this.layout);
    }
    if (visible) {
      this.bringForward(panel);
      this.clampPanels();
    }
    this.updateToggles();
  }

  updateToggles() {
    for (const button of document.querySelectorAll("[data-panel-toggle]")) {
      const panel = $(button.dataset.panelToggle);
      const visible = !!panel && !panel.hidden;
      button.classList.toggle("is-active", visible);
      button.setAttribute("aria-pressed", String(visible));
    }
  }

  positionPanel(panel, left, top) {
    const parent = panel.offsetParent;
    if (!parent || panel.hidden) return;
    const origin = parent.getBoundingClientRect();
    // A manually positioned window uses its natural size. Measure after removing
    // responsive scaling so a restored desktop window cannot slip offscreen.
    panel.style.transform = "none";
    const rect = panel.getBoundingClientRect();
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight =
      document.documentElement.clientHeight || window.innerHeight;
    const minLeft = Math.max(4, origin.left + 4);
    const minTop = Math.max(64, origin.top + 4);
    const maxLeft = Math.max(minLeft, viewportWidth - rect.width - 4);
    const maxTop = Math.max(minTop, viewportHeight - rect.height - 4);
    const x = Math.max(minLeft, Math.min(maxLeft, left));
    const y = Math.max(minTop, Math.min(maxTop, top));
    panel.style.left = `${x - origin.left + parent.scrollLeft}px`;
    panel.style.top = `${y - origin.top + parent.scrollTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.transform = "none";
  }

  clearPosition(panel) {
    for (const property of ["left", "top", "right", "bottom", "transform"])
      panel.style.removeProperty(property);
  }

  clampPanels() {
    if (!this.active) return;
    const narrow = window.innerWidth <= 620;
    if (narrow !== this.compact) {
      if (narrow) {
        this.desktopVisibility = new Map(
          this.panels.map((panel) => [panel.id, !panel.hidden]),
        );
        for (const panel of this.panels) panel.hidden = true;
      } else {
        for (const panel of this.panels)
          panel.hidden = !(
            this.desktopVisibility?.get(panel.id) ?? this.defaults.get(panel.id)
          );
        this.desktopVisibility = null;
      }
      this.compact = narrow;
      this.updateToggles();
    }
    for (const panel of this.panels) {
      if (panel.hidden || !panel.offsetParent) continue;
      if (this.compact) {
        this.clearPosition(panel);
        const origin = panel.offsetParent.getBoundingClientRect();
        this.positionPanel(
          panel,
          (window.innerWidth - panel.offsetWidth) / 2,
          origin.top + 10,
        );
        continue;
      }
      const saved = this.layout[panel.id];
      const sameViewport =
        !saved?.viewportWidth ||
        (saved.viewportWidth === window.innerWidth &&
          saved.viewportHeight === window.innerHeight);
      if (
        sameViewport &&
        Number.isFinite(saved?.left) &&
        Number.isFinite(saved?.top)
      )
        this.positionPanel(panel, saved.left, saved.top);
      else this.clearPosition(panel);
    }
  }

  resetLayout() {
    this.layout = {};
    save(LAYOUT_KEY, this.layout);
    for (const panel of this.panels) {
      for (const property of [
        "left",
        "top",
        "right",
        "bottom",
        "transform",
        "z-index",
      ])
        panel.style.removeProperty(property);
      panel.hidden = this.compact || !this.defaults.get(panel.id);
    }
    if (this.compact) this.desktopVisibility = new Map(this.defaults);
    this.updateToggles();
    this.notice("Window layout restored.");
    this.focusGame();
  }

  renderHotkeys() {
    const hotbar = $("hotbar");
    if (!hotbar) return;
    hotbar.replaceChildren();
    this.hotkeys.forEach((words, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `hotbar-slot hotkey-slot${words ? "" : " is-empty"}`;
      button.dataset.hotkey = String(index + 1);
      button.title = words
        ? `F${index + 1}: ${words} · Right-click to edit`
        : `Assign F${index + 1}`;
      button.setAttribute("aria-label", button.title);
      const key = document.createElement("kbd");
      key.textContent = `F${index + 1}`;
      const icon = document.createElement("canvas");
      icon.className = "hotkey-icon";
      icon.width = icon.height = 32;
      if (words) icon.dataset.itemIcon = String(spellIcon(words));
      const label = document.createElement("span");
      label.className = "hotkey-label";
      label.textContent = words || "+";
      button.append(key, icon, label);
      button.addEventListener("click", () => this.activateSlot(index));
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.editSlot(index);
      });
      hotbar.append(button);
    });
    this.iconsReady = false;
    this.drawIcons();
  }

  createHotkeyEditor() {
    const dialog = document.createElement("dialog");
    dialog.className = "hotkey-dialog";
    dialog.id = "hotkey-dialog";
    dialog.setAttribute("aria-labelledby", "hotkey-editor-title");
    dialog.innerHTML = `<form>
      <h2 id="hotkey-editor-title">Assign shortcut</h2>
      <p>Send spell words or a local chat message. Leave empty to clear this slot.</p>
      <label for="hotkey-words">Spell words or message</label>
      <input id="hotkey-words" type="text" maxlength="255" autocomplete="off" spellcheck="false" />
      <p id="hotkey-editor-error" role="alert"></p>
      <div class="dialog-actions"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">Save shortcut</button></div>
    </form>`;
    dialog.addEventListener("keydown", (event) => {
      if (/^F[1-8]$/.test(event.code || event.key)) event.preventDefault();
      event.stopPropagation();
    });
    dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
    dialog.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const words = dialog.querySelector("input").value.trim();
      if ([...words].some((character) => character.codePointAt(0) > 255)) {
        text("hotkey-editor-error", "Use Latin-1 characters with this server.");
        return;
      }
      this.hotkeys[this.editingSlot] = words;
      save(HOTKEYS_KEY, this.hotkeys);
      this.renderHotkeys();
      dialog.close();
    };
    dialog.addEventListener("close", () => this.focusGame());
    document.body.append(dialog);
    this.editor = dialog;
  }

  editSlot(index) {
    if (!this.active || document.querySelector("dialog[open]")) return;
    this.editingSlot = index;
    text("hotkey-editor-title", `Assign F${index + 1}`);
    text("hotkey-editor-error", "");
    const input = this.editor.querySelector("input");
    input.value = this.hotkeys[index];
    this.editor.showModal();
    input.focus();
    input.select();
  }

  activateSlot(index) {
    if (!this.active || document.querySelector("dialog[open]")) return;
    const words = this.hotkeys[index];
    if (!words) {
      this.editSlot(index);
      return;
    }
    try {
      this.send(new Writer(0x96).u8(1).string(words));
      this.focusGame();
    } catch (error) {
      this.notice(error.message);
    }
  }

  isTyping(target = document.activeElement) {
    return !!(
      document.querySelector("dialog[open]") ||
      target?.closest?.(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      )
    );
  }

  keydown(event) {
    const match = /^F([1-8])$/.exec(event.code || event.key);
    if (
      !match ||
      !this.active ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    if (this.isTyping(event.target)) return;
    if (!event.repeat) this.activateSlot(Number(match[1]) - 1);
  }

  drawIcons() {
    if (!this.assets.loaded || this.iconsReady) return;
    for (const canvas of document.querySelectorAll("canvas[data-item-icon]")) {
      const id = Number(canvas.dataset.itemIcon);
      if (!Number.isInteger(id) || !this.assets.get(id)) continue;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(canvas.width, canvas.height) / 32;
      ctx.save();
      ctx.scale(scale, scale);
      this.assets.draw(ctx, id, 0, 0, { frame: 0 });
      ctx.restore();
    }
    this.iconsReady = true;
  }

  drawPortrait(player) {
    const canvas = $("top-avatar");
    const outfit = player?.outfit;
    const signature = JSON.stringify(outfit);
    if (!canvas || !this.assets.loaded || signature === this.portraitSignature)
      return;
    this.portraitSignature = signature;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!outfit) return;
    const id = outfit.type
      ? this.assets.data.itemCount + outfit.type
      : outfit.item;
    if (!id || !this.assets.get(id)) return;
    ctx.imageSmoothingEnabled = false;
    const scale = Math.min(canvas.width, canvas.height) / 40;
    ctx.save();
    ctx.scale(scale, scale);
    this.assets.draw(ctx, id, 6, 7, {
      outfit: outfit.type ? outfit : null,
      direction: 2,
      frame: 0,
    });
    ctx.restore();
  }

  startSession(protocol = this.getProtocol?.()) {
    if (!protocol) return;
    if (this.active && this.protocol === protocol) return;
    this.protocol = protocol;
    this.active = true;
    this.startedAt = performance.now();
    this.startExperience = Number.isFinite(protocol.stats?.experience)
      ? protocol.stats.experience
      : null;
    this.lastTick = -1;
    this.update(protocol);
    this.clampPanels();
    requestAnimationFrame(() => this.clampPanels());
  }

  update(protocol = this.getProtocol?.()) {
    if (!protocol) return;
    const stats = protocol.stats || {};
    if (
      this.active &&
      this.startExperience === null &&
      Number.isFinite(stats.experience)
    )
      this.startExperience = stats.experience;
    text("top-player-name", protocol.player?.name || "Adventurer");
    text(
      "top-player-detail",
      stats.level ? `LEVEL ${stats.level} · YUROTS 7.6` : "YUROTS 7.6",
    );
    const percent = Math.max(0, Math.min(100, stats.levelPercent || 0));
    if ($("xp-fill")) $("xp-fill").style.width = `${percent}%`;
    text("xp-label", `Lv ${stats.level || 0} · ${percent}%`);
    this.drawPortrait(protocol.player);
    this.drawIcons();
    this.updateSession(protocol);
  }

  session(protocol = this.protocol) {
    if (protocol?.huntState?.active) {
      const hunt = protocol.huntState;
      return {
        elapsedSeconds: hunt.seconds,
        experienceGained: hunt.experience,
        experiencePerHour:
          hunt.seconds > 0
            ? Math.round((hunt.experience * 3600) / hunt.seconds)
            : null,
      };
    }
    const elapsedSeconds = this.active
      ? Math.max(0, Math.floor((performance.now() - this.startedAt) / 1000))
      : 0;
    const experience = protocol?.stats?.experience;
    const experienceGained =
      this.startExperience !== null && Number.isFinite(experience)
        ? experience - this.startExperience
        : 0;
    return {
      elapsedSeconds,
      experienceGained,
      experiencePerHour:
        elapsedSeconds > 0
          ? Math.round((experienceGained * 3600) / elapsedSeconds)
          : null,
    };
  }

  updateSession(protocol = this.protocol) {
    const session = this.session(protocol);
    text("session-time", duration(session.elapsedSeconds));
    text("session-xp", number.format(session.experienceGained));
    text(
      "session-xp-hour",
      session.experiencePerHour === null
        ? "—"
        : number.format(session.experiencePerHour),
    );
    text("session-level", protocol?.stats?.level ?? "—");
    text(
      "session-progress",
      Number.isFinite(protocol?.stats?.levelPercent)
        ? `${protocol.stats.levelPercent}%`
        : "—",
    );
  }

  tick() {
    const second = Math.floor(performance.now() / 1000);
    if (!this.active || this.lastTick === second) return;
    this.lastTick = second;
    this.updateSession();
  }

  reset() {
    this.active = false;
    this.protocol = null;
    this.startedAt = null;
    this.startExperience = null;
    this.portraitSignature = "";
    if (this.editor.open) this.editor.close();
    this.updateSession();
    text("top-player-name", "Adventurer");
    text("top-player-detail", "YUROTS 7.6");
    const canvas = $("top-avatar");
    canvas?.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }

  disconnect() {
    this.reset();
  }

  state() {
    return {
      active: this.active,
      compact: this.compact,
      panels: Object.fromEntries(
        this.panels.map((panel) => [panel.id, !panel.hidden]),
      ),
      session: this.session(),
      hotkeys: this.hotkeys.map((words, index) => ({
        key: `F${index + 1}`,
        words,
      })),
    };
  }
}
